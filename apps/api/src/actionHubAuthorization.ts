import type {
  FastifyInstance,
  FastifyRequest
} from "fastify";

import {
  ActionHubStore
} from "./actionHubStore.js";
import {
  runtimePath
} from "./runtimePaths.js";
import {
  TenancyStore
} from "./tenancyStore.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";

export function registerActionHubAuthorizationHook(input: {
  app: FastifyInstance;
  repoRoot: string;
}) {
  const tenancy = new TenancyStore(
    runtimePath(
      input.repoRoot,
      "tenancy",
      "tenancy.sqlite"
    )
  );
  const store = new ActionHubStore(
    runtimePath(
      input.repoRoot,
      "action-hub",
      "action-hub.enc.json"
    ),
    runtimePath(
      input.repoRoot,
      "action-hub",
      "action-hub.key"
    )
  );

  input.app.addHook(
    "preHandler",
    async (request, reply) => {
      const path = pathname(request);
      const organizationId = organizationFrom(request);
      const memberId = memberFrom(request);

      const directMatch = path.match(
        /^\/api\/action-hub\/actions\/([^/]+)\/execute$/
      );

      if (directMatch) {
        const actionId = decodeURIComponent(
          directMatch[1] ?? ""
        );
        const action = store.getAction(
          organizationId,
          actionId
        );

        if (
          action &&
          !isAuthorized(
            tenancy,
            organizationId,
            memberId,
            effectivePermission(action.id, action.permissionAction)
          )
        ) {
          return reply.code(403).send({
            ok: false,
            error:
              `Missing permission for Action ${action.id}: ${action.permissionAction}`
          });
        }
        return;
      }

      if (path === "/api/action-hub/mcp") {
        const body = asRecord(request.body);
        if (body?.method !== "tools/call") return;
        const params = asRecord(body.params);
        const actionId =
          typeof params?.name === "string"
            ? params.name
            : "";
        if (!actionId) return;

        const action = store.getAction(
          organizationId,
          actionId
        );
        if (
          action &&
          !isAuthorized(
            tenancy,
            organizationId,
            memberId,
            effectivePermission(action.id, action.permissionAction)
          )
        ) {
          return reply.code(403).send({
            jsonrpc: "2.0",
            id:
              typeof body.id === "string" ||
              typeof body.id === "number" ||
              body.id === null
                ? body.id
                : null,
            error: {
              code: -32003,
              message:
                `Missing permission for Action ${action.id}: ${action.permissionAction}`
            }
          });
        }
        return;
      }

      const approvalMatch = path.match(
        /^\/api\/action-hub\/approvals\/([^/]+)\/decision$/
      );
      if (!approvalMatch) return;

      const body = asRecord(request.body);
      if (body?.decision !== "approved") return;

      const approval = store.getApproval(
        organizationId,
        decodeURIComponent(approvalMatch[1] ?? "")
      );
      if (!approval) return;

      const action = store.getAction(
        organizationId,
        approval.actionId
      );
      if (!action) return;

      if (
        !isAuthorized(
          tenancy,
          organizationId,
          approval.memberId,
          effectivePermission(action.id, action.permissionAction)
        )
      ) {
        return reply.code(403).send({
          ok: false,
          error:
            `Requester no longer has permission for Action ${action.id}: ${action.permissionAction}`
        });
      }
    }
  );
}

function effectivePermission(
  actionId: string,
  permissionAction: string
): string {
  // `ai.generate` predates Action Hub and is already available to users
  // who can access enterprise applications. New/custom actions keep their
  // explicit permission string and therefore require a matching role grant.
  if (
    actionId === "ai.generate" &&
    permissionAction === "ai.generate"
  ) {
    return "apps.read";
  }

  return permissionAction;
}

function isAuthorized(
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

function pathname(
  request: FastifyRequest
): string {
  try {
    return new URL(
      request.raw.url ?? request.url,
      "http://oeap.local"
    ).pathname;
  } catch {
    return request.url.split("?")[0] ?? request.url;
  }
}

function asRecord(
  value: unknown
): Record<string, unknown> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
