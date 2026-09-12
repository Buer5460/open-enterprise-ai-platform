import type {
  OEAPSkillManifest
} from "@oeap/package-spec";

import {
  actionGateway,
  type ActionRequest,
  type ActionResult
} from "@oeap/action-gateway";

export interface SkillExecutionContext {
  workspaceId?: string;
  userId?: string;
  agentId?: string;
  taskId?: string;

  metadata?: Record<string, unknown>;

  action<TInput = unknown, TOutput = unknown>(
    request: Omit<
      ActionRequest<TInput>,
      "requestId" | "subject" | "workspaceId"
    >
  ): Promise<ActionResult<TOutput>>;
}

export interface SkillExecutor<
  TInput = unknown,
  TOutput = unknown
> {
  manifest: OEAPSkillManifest;

  execute(
    input: TInput,
    context: SkillExecutionContext
  ): Promise<TOutput>;
}

export interface SkillRunRequest<TInput = unknown> {
  skillId: string;

  input: TInput;

  workspaceId?: string;
  userId?: string;
  agentId?: string;
  taskId?: string;

  metadata?: Record<string, unknown>;
}

export interface SkillRunResult<TOutput = unknown> {
  ok: boolean;

  output?: TOutput;

  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class SkillRuntime {
  private readonly skills =
    new Map<string, SkillExecutor>();

  register(skill: SkillExecutor): void {
    if (skill.manifest.type !== "skill") {
      throw new Error(
        `Invalid package type for skill: ${skill.manifest.type}`
      );
    }

    if (this.skills.has(skill.manifest.id)) {
      throw new Error(
        `Skill already registered: ${skill.manifest.id}`
      );
    }

    this.skills.set(
      skill.manifest.id,
      skill
    );
  }

  unregister(skillId: string): void {
    this.skills.delete(skillId);
  }

  get(
    skillId: string
  ): SkillExecutor | undefined {
    return this.skills.get(skillId);
  }

  list(): OEAPSkillManifest[] {
    return [...this.skills.values()].map(
      (skill) => skill.manifest
    );
  }

  async run<
    TInput = unknown,
    TOutput = unknown
  >(
    request: SkillRunRequest<TInput>
  ): Promise<SkillRunResult<TOutput>> {
    const skill =
      this.skills.get(request.skillId);

    if (!skill) {
      return {
        ok: false,
        error: {
          code: "SKILL_NOT_FOUND",
          message:
            `Skill not registered: ${request.skillId}`
        }
      };
    }

    let actionSequence = 0;

    const context: SkillExecutionContext = {
      workspaceId: request.workspaceId,
      userId: request.userId,
      agentId: request.agentId,
      taskId: request.taskId,
      metadata: request.metadata,

      async action<TActionInput, TActionOutput>(
        actionRequest: Omit<
          ActionRequest<TActionInput>,
          "requestId" | "subject" | "workspaceId"
        >
      ): Promise<ActionResult<TActionOutput>> {
        actionSequence += 1;

        const baseId =
          request.taskId ??
          `skill:${request.skillId}`;

        return actionGateway.execute<
          TActionInput,
          TActionOutput
        >({
          ...actionRequest,

          requestId:
            `${baseId}:action:${actionSequence}`,

          subject: request.agentId
            ? {
                type: "agent",
                id: request.agentId
              }
            : {
                type: "package",
                id: request.skillId
              },

          workspaceId:
            request.workspaceId
        });
      }
    };

    try {
      const output =
        await skill.execute(
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
          code: "SKILL_EXECUTION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Unknown skill execution error",
          details: error
        }
      };
    }
  }
}

export const skillRuntime =
  new SkillRuntime();
