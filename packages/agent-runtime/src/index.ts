import type {
  OEAPAgentManifest
} from "@oeap/package-spec";

import {
  skillRuntime,
  type SkillRunResult
} from "@oeap/skill-runtime";

export interface AgentExecutionContext {
  workspaceId?: string;
  userId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;

  runSkill<TInput = unknown, TOutput = unknown>(
    skillId: string,
    input: TInput
  ): Promise<SkillRunResult<TOutput>>;
}

export interface AgentExecutor<
  TInput = unknown,
  TOutput = unknown
> {
  manifest: OEAPAgentManifest;

  execute(
    input: TInput,
    context: AgentExecutionContext
  ): Promise<TOutput>;
}

export interface AgentRunRequest<TInput = unknown> {
  agentId: string;
  input: TInput;

  workspaceId?: string;
  userId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunResult<TOutput = unknown> {
  ok: boolean;
  output?: TOutput;

  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type AgentContextEnricher = (
  request: AgentRunRequest<unknown>
) =>
  | Record<string, unknown>
  | undefined
  | Promise<Record<string, unknown> | undefined>;

export class AgentRuntime {
  private readonly agents =
    new Map<string, AgentExecutor>();

  private readonly contextEnrichers =
    new Map<string, AgentContextEnricher>();

  register(agent: AgentExecutor): void {
    if (agent.manifest.type !== "agent") {
      throw new Error(
        `Invalid package type for agent: ${agent.manifest.type}`
      );
    }

    if (this.agents.has(agent.manifest.id)) {
      throw new Error(
        `Agent already registered: ${agent.manifest.id}`
      );
    }

    this.agents.set(
      agent.manifest.id,
      agent
    );
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  registerContextEnricher(
    id: string,
    enricher: AgentContextEnricher
  ): void {
    if (!id.trim()) {
      throw new Error("Agent context enricher id is required");
    }
    this.contextEnrichers.set(id, enricher);
  }

  unregisterContextEnricher(id: string): void {
    this.contextEnrichers.delete(id);
  }

  get(agentId: string): AgentExecutor | undefined {
    return this.agents.get(agentId);
  }

  list(): OEAPAgentManifest[] {
    return [...this.agents.values()].map(
      (agent) => agent.manifest
    );
  }

  async run<
    TInput = unknown,
    TOutput = unknown
  >(
    request: AgentRunRequest<TInput>
  ): Promise<AgentRunResult<TOutput>> {
    const agent =
      this.agents.get(request.agentId);

    if (!agent) {
      return {
        ok: false,
        error: {
          code: "AGENT_NOT_FOUND",
          message:
            `Agent not registered: ${request.agentId}`
        }
      };
    }

    let metadata: Record<string, unknown> = {
      ...(request.metadata ?? {})
    };

    for (const enricher of this.contextEnrichers.values()) {
      try {
        const enrichment = await enricher({
          ...request,
          metadata
        } as AgentRunRequest<unknown>);
        if (enrichment) {
          metadata = {
            ...metadata,
            ...enrichment
          };
        }
      } catch (error) {
        metadata = {
          ...metadata,
          contextEnrichmentWarnings: [
            ...(
              Array.isArray(metadata.contextEnrichmentWarnings)
                ? metadata.contextEnrichmentWarnings as unknown[]
                : []
            ),
            error instanceof Error
              ? error.message
              : "Agent context enrichment failed"
          ]
        };
      }
    }

    const context: AgentExecutionContext = {
      workspaceId: request.workspaceId,
      userId: request.userId,
      taskId: request.taskId,
      metadata,

      async runSkill<TSkillInput, TSkillOutput>(
        skillId: string,
        input: TSkillInput
      ) {
        return skillRuntime.run<
          TSkillInput,
          TSkillOutput
        >({
          skillId,
          input,
          workspaceId: request.workspaceId,
          userId: request.userId,
          agentId: request.agentId,
          taskId:
            request.taskId ??
            `agent:${request.agentId}`,
          metadata
        });
      }
    };

    try {
      const output =
        await agent.execute(
          request.input,
          context
        );

      return {
        ok: true,
        output: output as TOutput
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "AGENT_EXECUTION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Unknown agent execution error",
          details: error
        }
      };
    }
  }
}

export const agentRuntime =
  new AgentRuntime();
