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

export class AgentRuntime {
  private readonly agents =
    new Map<string, AgentExecutor>();

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

    const context: AgentExecutionContext = {
      workspaceId: request.workspaceId,
      userId: request.userId,
      taskId: request.taskId,
      metadata: request.metadata,

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
          metadata: request.metadata
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
