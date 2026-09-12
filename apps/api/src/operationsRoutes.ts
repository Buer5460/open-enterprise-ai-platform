import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { join } from "node:path";

import {
  OperationsStore,
  type ApprovalStatus
} from "./operationsStore.js";
import {
  TenancyStore
} from "./tenancyStore.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";

export function registerOperationsRoutes(input: {
  app: FastifyInstance;
  repoRoot: string;
}) {
  const tenancy = new TenancyStore(
    join(
      input.repoRoot,
      ".tmp",
      "tenancy",
      "tenancy.sqlite"
    )
  );
  const store = new OperationsStore(
    join(
      input.repoRoot,
      ".tmp",
      "operations",
      "operations.sqlite"
    )
  );

  input.app.addHook(
    "onResponse",
    async (request, reply) => {
      const path =
        request.routeOptions.url ||
        request.url.split("?")[0];

      if (
        path === "/health" ||
        path.startsWith("/api/auth/") ||
        path.startsWith("/api/operations/")
      ) {
        return;
      }

      const organizationId =
        organizationFrom(request);
      const memberId = memberFrom(request);

      store.recordEvent({
        organizationId,
        memberId,
        category: categorize(path),
        action: actionName(
          request.method,
          path
        ),
        method: request.method,
        path,
        statusCode: reply.statusCode,
        durationMs:
          typeof reply.elapsedTime === "number"
            ? Math.round(reply.elapsedTime)
            : 0
      });
    }
  );

  input.app.get<{
    Querystring: {
      days?: string;
    };
  }>(
    "/api/operations/summary",
    async (request, reply) => {
      const identity = requireViewer(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      return {
        ok: true,
        manager: identity.manager,
        summary: store.summary({
          organizationId: identity.organizationId,
          memberId:
            identity.manager
              ? undefined
              : identity.memberId,
          days: Number(request.query.days || 30) || 30
        })
      };
    }
  );

  input.app.get<{
    Querystring: {
      limit?: string;
    };
  }>(
    "/api/operations/events",
    async (request, reply) => {
      const identity = requireViewer(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      return {
        ok: true,
        manager: identity.manager,
        events: store.listEvents({
          organizationId: identity.organizationId,
          memberId:
            identity.manager
              ? undefined
              : identity.memberId,
          limit: Number(request.query.limit || 100) || 100
        })
      };
    }
  );

  input.app.get<{
    Querystring: {
      status?: ApprovalStatus;
      limit?: string;
    };
  }>(
    "/api/operations/approvals",
    async (request, reply) => {
      const identity = requireViewer(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      return {
        ok: true,
        manager: identity.manager,
        approvals: store.listApprovals({
          organizationId: identity.organizationId,
          createdBy:
            identity.manager
              ? undefined
              : identity.memberId,
          status: validStatus(request.query.status),
          limit: Number(request.query.limit || 100) || 100
        })
      };
    }
  );

  input.app.post<{
    Body: {
      title?: string;
      description?: string;
      actionType?: string;
      payload?: unknown;
    };
  }>(
    "/api/operations/approvals",
    async (request, reply) => {
      const identity = requireViewer(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const body = request.body ?? {};
      const title = body.title?.trim();
      const actionType = body.actionType?.trim();

      if (!title || !actionType) {
        return reply.code(400).send({
          ok: false,
          error: "title and actionType are required"
        });
      }

      const approval = store.createApproval({
        organizationId: identity.organizationId,
        createdBy: identity.memberId,
        title,
        description: body.description,
        actionType,
        payload: body.payload
      });

      return {
        ok: true,
        approval
      };
    }
  );

  input.app.post<{
    Params: { approvalId: string };
    Body: {
      decision?: "approved" | "rejected";
      note?: string;
    };
  }>(
    "/api/operations/approvals/:approvalId/decision",
    async (request, reply) => {
      const identity = requireManager(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      if (
        request.body?.decision !== "approved" &&
        request.body?.decision !== "rejected"
      ) {
        return reply.code(400).send({
          ok: false,
          error: "decision must be approved or rejected"
        });
      }

      try {
        return {
          ok: true,
          approval: store.decide({
            id: request.params.approvalId,
            organizationId:
              identity.organizationId,
            decidedBy: identity.memberId,
            decision:
              request.body.decision,
            note: request.body.note
          })
        };
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Approval decision failed"
        });
      }
    }
  );

  input.app.post<{
    Params: { approvalId: string };
  }>(
    "/api/operations/approvals/:approvalId/cancel",
    async (request, reply) => {
      const identity = requireViewer(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      try {
        return {
          ok: true,
          approval: store.cancel({
            id: request.params.approvalId,
            organizationId:
              identity.organizationId,
            memberId: identity.memberId
          })
        };
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Approval cancellation failed"
        });
      }
    }
  );
}

function requireViewer(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply
): {
  organizationId: string;
  memberId: string;
  manager: boolean;
} | undefined {
  const organizationId = organizationFrom(request);
  const memberId = memberFrom(request);

  if (!authorize(
    tenancy,
    organizationId,
    memberId,
    "apps.read"
  )) {
    return forbidden(reply);
  }

  return {
    organizationId,
    memberId,
    manager: authorize(
      tenancy,
      organizationId,
      memberId,
      "org.manage"
    )
  };
}

function requireManager(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply
): {
  organizationId: string;
  memberId: string;
} | undefined {
  const organizationId = organizationFrom(request);
  const memberId = memberFrom(request);

  if (!authorize(
    tenancy,
    organizationId,
    memberId,
    "org.manage"
  )) {
    return forbidden(reply);
  }

  return {
    organizationId,
    memberId
  };
}

function authorize(
  tenancy: TenancyStore,
  organizationId: string,
  memberId: string,
  permission: string
): boolean {
  try {
    return tenancy.authorize({
      organizationId,
      memberId,
      permission
    });
  } catch {
    return false;
  }
}

function forbidden(reply: FastifyReply) {
  reply.code(403).send({
    ok: false,
    error: "Forbidden"
  });
  return undefined;
}

function validStatus(
  value?: string
): ApprovalStatus | undefined {
  return [
    "pending",
    "approved",
    "rejected",
    "cancelled"
  ].includes(value || "")
    ? value as ApprovalStatus
    : undefined;
}

function categorize(path: string): string {
  if (
    path.includes("/generate") ||
    path.includes("/revise")
  ) return "ai";
  if (path.startsWith("/api/files")) return "file";
  if (
    path.startsWith("/api/invitations") ||
    path.startsWith("/api/tenancy")
  ) return "identity";
  if (path.startsWith("/api/platform")) return "package";
  if (path.includes("/data/")) return "data";
  return "api";
}

function actionName(
  method: string,
  path: string
): string {
  return `${method.toUpperCase()} ${path}`;
}
