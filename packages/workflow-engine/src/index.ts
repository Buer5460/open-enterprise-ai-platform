import type {
  OEAPWorkflowManifest,
  OEAPWorkflowStep
} from "@oeap/package-spec";

import {
  skillRuntime
} from "@oeap/skill-runtime";

import {
  agentRuntime
} from "@oeap/agent-runtime";

import {
  eventBus
} from "@oeap/event-bus";

export interface WorkflowExecutor {
  manifest: OEAPWorkflowManifest;
}

export interface WorkflowRunRequest {
  workflowId: string;
  input: unknown;

  workspaceId?: string;
  userId?: string;
  taskId?: string;

  metadata?: Record<string, unknown>;
}

export interface WorkflowStepResult {
  stepId: string;
  type: string;
  ok: boolean;
  output?: unknown;
  error?: unknown;
}

export interface WorkflowRunResult {
  ok: boolean;
  output?: unknown;
  steps: WorkflowStepResult[];

  error?: {
    code: string;
    message: string;
  };
}

export class WorkflowRuntime {
  private readonly workflows =
    new Map<string, WorkflowExecutor>();

  register(workflow: WorkflowExecutor): void {
    if (workflow.manifest.type !== "workflow") {
      throw new Error(
        `Invalid workflow package type: ${workflow.manifest.type}`
      );
    }

    if (this.workflows.has(workflow.manifest.id)) {
      throw new Error(
        `Workflow already registered: ${workflow.manifest.id}`
      );
    }

    this.workflows.set(
      workflow.manifest.id,
      workflow
    );
  }

  unregister(workflowId: string): void {
    this.workflows.delete(workflowId);
  }

  list(): OEAPWorkflowManifest[] {
    return [...this.workflows.values()].map(
      (item) => item.manifest
    );
  }

  async run(
    request: WorkflowRunRequest
  ): Promise<WorkflowRunResult> {
    const workflow =
      this.workflows.get(request.workflowId);

    if (!workflow) {
      return {
        ok: false,
        steps: [],
        error: {
          code: "WORKFLOW_NOT_FOUND",
          message:
            `Workflow not registered: ${request.workflowId}`
        }
      };
    }

    const runId =
      request.taskId ??
      `workflow:${request.workflowId}:${Date.now()}`;

    await eventBus.publish({
      id: `${runId}:started`,
      type: "workflow.started",
      source: {
        type: "workflow",
        id: request.workflowId
      },
      payload: {
        runId,
        input: request.input
      }
    });

    let current: unknown = request.input;

    const results: WorkflowStepResult[] = [];

    try {
      for (const step of workflow.manifest.steps) {
        const result = await this.runStep(
          step,
          current,
          request,
          runId
        );

        results.push(result);

        if (!result.ok) {
          throw new Error(
            `Workflow step failed: ${step.id}`
          );
        }

        current = result.output;
      }

      await eventBus.publish({
        id: `${runId}:completed`,
        type: "workflow.completed",
        source: {
          type: "workflow",
          id: request.workflowId
        },
        payload: {
          runId,
          output: current
        }
      });

      return {
        ok: true,
        output: current,
        steps: results
      };
    } catch (error) {
      await eventBus.publish({
        id: `${runId}:failed`,
        type: "workflow.failed",
        source: {
          type: "workflow",
          id: request.workflowId
        },
        payload: {
          runId,
          error:
            error instanceof Error
              ? error.message
              : String(error)
        }
      });

      return {
        ok: false,
        output: current,
        steps: results,
        error: {
          code: "WORKFLOW_EXECUTION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Unknown workflow error"
        }
      };
    }
  }

  private async runStep(
    step: OEAPWorkflowStep,
    input: unknown,
    request: WorkflowRunRequest,
    runId: string
  ): Promise<WorkflowStepResult> {
    if (step.type === "skill") {
      if (!step.target) {
        return {
          stepId: step.id,
          type: step.type,
          ok: false,
          error: "Missing skill target"
        };
      }

      const result = await skillRuntime.run({
        skillId: step.target,
        input,
        workspaceId: request.workspaceId,
        userId: request.userId,
        taskId: `${runId}:${step.id}`,
        metadata: request.metadata
      });

      return {
        stepId: step.id,
        type: step.type,
        ok: result.ok,
        output: result.output,
        error: result.error
      };
    }

    if (step.type === "agent") {
      if (!step.target) {
        return {
          stepId: step.id,
          type: step.type,
          ok: false,
          error: "Missing agent target"
        };
      }

      const result = await agentRuntime.run({
        agentId: step.target,
        input,
        workspaceId: request.workspaceId,
        userId: request.userId,
        taskId: `${runId}:${step.id}`,
        metadata: request.metadata
      });

      return {
        stepId: step.id,
        type: step.type,
        ok: result.ok,
        output: result.output,
        error: result.error
      };
    }

    if (step.type === "wait") {
      const milliseconds =
        typeof step.config?.milliseconds === "number"
          ? step.config.milliseconds
          : 0;

      if (milliseconds > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, milliseconds)
        );
      }

      return {
        stepId: step.id,
        type: step.type,
        ok: true,
        output: input
      };
    }

    return {
      stepId: step.id,
      type: step.type,
      ok: false,
      error:
        `Step type not implemented yet: ${step.type}`
    };
  }
}

export const workflowRuntime =
  new WorkflowRuntime();
