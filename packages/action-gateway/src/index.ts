import {
  permissionEngine,
  type PermissionSubject
} from "@oeap/permission-engine";

import {
  approvalEngine
} from "@oeap/approval-engine";

import {
  auditLog
} from "@oeap/audit-log";

import {
  connectorRuntime
} from "@oeap/connector-runtime";

export interface ActionRequest<TInput = unknown> {
  requestId: string;

  subject: PermissionSubject;

  action: string;

  capability: string;

  input: TInput;

  resource?: string;

  workspaceId?: string;

  preferredProvider?: string;

  metadata?: Record<string, unknown>;
}

export interface ActionResult<TOutput = unknown> {
  status:
    | "executed"
    | "denied"
    | "approval_required"
    | "failed";

  approvalId?: string;

  output?: TOutput;

  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

let auditSequence = 0;

function nextAuditId(requestId: string): string {
  auditSequence += 1;

  return `audit:${requestId}:${Date.now()}:${auditSequence}`;
}

export class ActionGateway {
  async execute<TInput = unknown, TOutput = unknown>(
    request: ActionRequest<TInput>
  ): Promise<ActionResult<TOutput>> {
    const decision = permissionEngine.evaluate({
      subject: request.subject,
      action: request.action,
      resource: request.resource,
      workspaceId: request.workspaceId,
      metadata: request.metadata
    });

    if (decision.effect === "deny") {
      auditLog.record({
        id: nextAuditId(request.requestId),
        workspaceId: request.workspaceId,
        actor: request.subject,
        action: request.action,
        resource: request.resource,
        result: "denied",
        metadata: {
          requestId: request.requestId,
          reason: decision.reason
        }
      });

      return {
        status: "denied",
        error: {
          code: "PERMISSION_DENIED",
          message:
            decision.reason ??
            "Action denied by permission policy"
        }
      };
    }

    if (decision.effect === "approval") {
      const approvalId =
        `approval:${request.requestId}`;

      const existing =
        approvalEngine.get(approvalId);

      if (!existing) {
        approvalEngine.create({
          id: approvalId,
          workspaceId: request.workspaceId,
          requestedBy: request.subject,
          action: request.action,
          resource: request.resource,
          payload: request.input,
          reason: decision.reason,
          metadata: {
            requestId: request.requestId,
            capability: request.capability
          }
        });

        auditLog.record({
          id: nextAuditId(request.requestId),
          workspaceId: request.workspaceId,
          actor: request.subject,
          action: request.action,
          resource: request.resource,
          result: "approval_required",
          metadata: {
            requestId: request.requestId,
            approvalId
          }
        });

        return {
          status: "approval_required",
          approvalId
        };
      }

      if (existing.status === "pending") {
        return {
          status: "approval_required",
          approvalId
        };
      }

      if (existing.status !== "approved") {
        return {
          status: "denied",
          approvalId,
          error: {
            code: "APPROVAL_NOT_GRANTED",
            message:
              `Approval status: ${existing.status}`
          }
        };
      }
    }

    const execution =
      await connectorRuntime.invoke<TInput, TOutput>({
        capability: request.capability,
        input: request.input,
        preferredProvider:
          request.preferredProvider,
        context: {
          workspaceId: request.workspaceId,
          taskId: request.requestId,
          metadata: request.metadata
        }
      });

    if (!execution.ok) {
      auditLog.record({
        id: nextAuditId(request.requestId),
        workspaceId: request.workspaceId,
        actor: request.subject,
        action: request.action,
        resource: request.resource,
        result: "failed",
        metadata: {
          requestId: request.requestId,
          error: execution.error
        }
      });

      return {
        status: "failed",
        error: execution.error
      };
    }

    auditLog.record({
      id: nextAuditId(request.requestId),
      workspaceId: request.workspaceId,
      actor: request.subject,
      action: request.action,
      resource: request.resource,
      result: "success",
      metadata: {
        requestId: request.requestId,
        capability: request.capability
      }
    });

    return {
      status: "executed",
      output: execution.output
    };
  }
}

export const actionGateway =
  new ActionGateway();
