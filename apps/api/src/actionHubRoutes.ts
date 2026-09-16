import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

import {
  connectorRuntime
} from "@oeap/connector-runtime";
import {
  actionPolicy,
  compileUniversalAction,
  normalizeUniversalActionDefinition,
  supportedUniversalActionAdapters,
  validateUniversalActionDefinition,
  validateUniversalActionInput,
  type UniversalActionAdapter,
  type UniversalActionDefinition
} from "@oeap/package-spec";

import {
  ensureAIRuntimeProvidersRegistered
} from "./aiRuntime.js";
import {
  ActionHubStore,
  type ActionHubApproval,
  type ActionHubApprovalStatus
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

const MODERN_MCP_VERSION = "2026-07-28";
const LEGACY_MCP_VERSION = "2025-11-25";

export function registerActionHubRoutes(input: {
  app: FastifyInstance;
  repoRoot: string;
  openEnterpriseRoot: string;
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

  input.app.get(
    "/api/action-hub/summary",
    async (request, reply) => {
      const identity = requireViewer(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const actions = store.listActions(
        identity.organizationId
      );
      const approvals = store.listApprovals({
        organizationId: identity.organizationId,
        memberId:
          identity.manager
            ? undefined
            : identity.memberId,
        limit: 500
      });
      const events = store.listEvents({
        organizationId: identity.organizationId,
        memberId:
          identity.manager
            ? undefined
            : identity.memberId,
        limit: 100
      });

      return {
        ok: true,
        manager: identity.manager,
        summary: {
          actions: actions.length,
          enabledActions:
            actions.filter((item) => item.enabled).length,
          pendingApprovals:
            approvals.filter((item) => item.status === "pending").length,
          executions24h:
            events.filter((item) =>
              Date.parse(item.createdAt) >= Date.now() - 86_400_000
            ).length,
          adapters:
            supportedUniversalActionAdapters().length
        },
        endpoints: {
          rest: "/api/action-hub/actions/:actionId/execute",
          mcp: "/api/action-hub/mcp",
          openapi: "/api/action-hub/openapi.json"
        },
        riskModel: [
          actionPolicy("R0"),
          actionPolicy("R1"),
          actionPolicy("R2"),
          actionPolicy("R3")
        ]
      };
    }
  );

  input.app.get(
    "/api/action-hub/actions",
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
        actions: store.listActions(
          identity.organizationId
        )
      };
    }
  );

  input.app.put<{
    Params: { actionId: string };
    Body: UniversalActionDefinition;
  }>(
    "/api/action-hub/actions/:actionId",
    async (request, reply) => {
      const identity = requireManager(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const candidate = {
        ...(request.body ?? {}),
        id: request.params.actionId
      } as UniversalActionDefinition;
      const validation =
        validateUniversalActionDefinition(candidate);

      if (!validation.ok) {
        return reply.code(400).send({
          ok: false,
          error: "Invalid Universal Action definition",
          details: validation.errors
        });
      }

      const action =
        normalizeUniversalActionDefinition(candidate);

      return {
        ok: true,
        action: store.upsertAction(
          identity.organizationId,
          action
        )
      };
    }
  );

  input.app.delete<{
    Params: { actionId: string };
  }>(
    "/api/action-hub/actions/:actionId",
    async (request, reply) => {
      const identity = requireManager(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const action = store.getAction(
        identity.organizationId,
        request.params.actionId
      );

      if (!action) {
        return reply.code(404).send({
          ok: false,
          error: "Action not found"
        });
      }

      if (action.metadata?.builtin === true) {
        return reply.code(400).send({
          ok: false,
          error: "Built-in actions cannot be deleted; set enabled=false instead"
        });
      }

      return {
        ok: true,
        deleted: store.removeAction(
          identity.organizationId,
          request.params.actionId
        )
      };
    }
  );

  input.app.get<{
    Params: { actionId: string };
    Querystring: {
      adapter?: UniversalActionAdapter;
      apiBaseUrl?: string;
    };
  }>(
    "/api/action-hub/actions/:actionId/adapters",
    async (request, reply) => {
      const identity = requireViewer(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const action = store.getAction(
        identity.organizationId,
        request.params.actionId
      );

      if (!action) {
        return reply.code(404).send({
          ok: false,
          error: "Action not found"
        });
      }

      const adapters = request.query.adapter
        ? [request.query.adapter]
        : supportedUniversalActionAdapters();
      const supported =
        supportedUniversalActionAdapters();

      for (const adapter of adapters) {
        if (!supported.includes(adapter)) {
          return reply.code(400).send({
            ok: false,
            error: `Unsupported adapter: ${adapter}`
          });
        }
      }

      return {
        ok: true,
        action,
        compilations: adapters.map((adapter) =>
          compileUniversalAction(
            action,
            adapter,
            {
              apiBaseUrl:
                request.query.apiBaseUrl || publicBaseUrl(request)
            }
          )
        )
      };
    }
  );

  input.app.post<{
    Params: { actionId: string };
    Body: {
      input?: unknown;
      preferredProvider?: string;
    };
  }>(
    "/api/action-hub/actions/:actionId/execute",
    async (request, reply) => {
      const identity = requireViewer(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const result = await requestActionExecution({
        store,
        repoRoot: input.repoRoot,
        openEnterpriseRoot: input.openEnterpriseRoot,
        organizationId: identity.organizationId,
        memberId: identity.memberId,
        actionId: request.params.actionId,
        payload: request.body?.input ?? {},
        preferredProvider:
          request.body?.preferredProvider
      });

      return reply
        .code(result.httpStatus)
        .send(result.body);
    }
  );

  input.app.get<{
    Querystring: {
      status?: ActionHubApprovalStatus;
      limit?: string;
    };
  }>(
    "/api/action-hub/approvals",
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
          memberId:
            identity.manager
              ? undefined
              : identity.memberId,
          status: validApprovalStatus(
            request.query.status
          ),
          limit:
            Number(request.query.limit || 100) || 100
        })
      };
    }
  );

  input.app.post<{
    Params: { approvalId: string };
    Body: {
      decision?: "approved" | "rejected";
      confirmation?: string;
    };
  }>(
    "/api/action-hub/approvals/:approvalId/decision",
    async (request, reply) => {
      const identity = requireManager(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const decision = request.body?.decision;
      if (
        decision !== "approved" &&
        decision !== "rejected"
      ) {
        return reply.code(400).send({
          ok: false,
          error: "decision must be approved or rejected"
        });
      }

      const pending = store.getApproval(
        identity.organizationId,
        request.params.approvalId
      );

      if (!pending) {
        return reply.code(404).send({
          ok: false,
          error: "Approval not found"
        });
      }

      if (
        pending.risk === "R3" &&
        decision === "approved" &&
        request.body?.confirmation !== pending.actionId
      ) {
        return reply.code(400).send({
          ok: false,
          error:
            `R3 confirmation must exactly equal action id: ${pending.actionId}`
        });
      }

      let approval: ActionHubApproval;
      try {
        approval = store.decideApproval({
          organizationId: identity.organizationId,
          approvalId: pending.id,
          decidedBy: identity.memberId,
          decision
        });
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error: errorMessage(error)
        });
      }

      store.recordEvent({
        organizationId: identity.organizationId,
        memberId: pending.memberId,
        actionId: pending.actionId,
        status:
          decision === "approved"
            ? "approved"
            : "rejected",
        approvalId: pending.id
      });

      if (decision === "rejected") {
        return {
          ok: true,
          status: "rejected",
          approval
        };
      }

      const action = store.getAction(
        identity.organizationId,
        pending.actionId
      );

      if (!action || !action.enabled) {
        const failed = store.markApprovalExecution({
          organizationId: identity.organizationId,
          approvalId: pending.id,
          status: "failed",
          error:
            !action
              ? "Action no longer exists"
              : "Action is disabled"
        });

        return reply.code(409).send({
          ok: false,
          status: "failed",
          approval: failed,
          error: failed.error
        });
      }

      const result = await executeAction({
        store,
        repoRoot: input.repoRoot,
        openEnterpriseRoot: input.openEnterpriseRoot,
        organizationId: identity.organizationId,
        memberId: pending.memberId,
        action,
        payload: pending.input,
        preferredProvider: pending.preferredProvider,
        approvalId: pending.id
      });

      const completed = store.markApprovalExecution({
        organizationId: identity.organizationId,
        approvalId: pending.id,
        status:
          result.ok
            ? "executed"
            : "failed",
        error:
          result.ok
            ? undefined
            : result.error
      });

      return reply
        .code(result.ok ? 200 : 502)
        .send({
          ...result,
          status:
            result.ok
              ? "executed"
              : "failed",
          approval: completed
        });
    }
  );

  input.app.post<{
    Params: { approvalId: string };
  }>(
    "/api/action-hub/approvals/:approvalId/cancel",
    async (request, reply) => {
      const identity = requireViewer(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      try {
        const approval = store.cancelApproval({
          organizationId: identity.organizationId,
          approvalId: request.params.approvalId,
          memberId: identity.memberId,
          manager: identity.manager
        });

        store.recordEvent({
          organizationId: identity.organizationId,
          memberId: approval.memberId,
          actionId: approval.actionId,
          status: "cancelled",
          approvalId: approval.id
        });

        return {
          ok: true,
          approval
        };
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error: errorMessage(error)
        });
      }
    }
  );

  input.app.get<{
    Querystring: {
      limit?: string;
    };
  }>(
    "/api/action-hub/events",
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
          limit:
            Number(request.query.limit || 100) || 100
        })
      };
    }
  );

  input.app.get(
    "/api/action-hub/openapi.json",
    async (request, reply) => {
      const identity = requireViewer(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const actions = store.listActions(
        identity.organizationId
      ).filter((item) => item.enabled);

      const paths = Object.fromEntries(
        actions.map((action) => {
          const compilation = compileUniversalAction(
            action,
            "openapi"
          );
          const artifact = compilation.artifact;
          return [
            artifact.path as string,
            {
              post: {
                operationId: artifact.operationId,
                summary: artifact.summary,
                description: artifact.description,
                requestBody: artifact.requestBody,
                responses: artifact.responses
              }
            }
          ];
        })
      );

      return {
        openapi: "3.1.0",
        info: {
          title: "OEAP AI Action Hub",
          version: "1.0.0",
          description:
            "Organization-scoped Universal Actions exposed by Open Enterprise AI Platform."
        },
        servers: [
          { url: publicBaseUrl(request) }
        ],
        paths
      };
    }
  );

  input.app.post<{
    Body: JsonRpcRequest;
  }>(
    "/api/action-hub/mcp",
    async (request, reply) => {
      const identity = requireViewer(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const rpc = request.body;
      if (
        !rpc ||
        rpc.jsonrpc !== "2.0" ||
        typeof rpc.method !== "string"
      ) {
        return reply.code(400).send(
          jsonRpcError(
            rpc?.id ?? null,
            -32600,
            "Invalid Request"
          )
        );
      }

      const headerError =
        validateMcpHeaders(request, rpc);
      if (headerError) {
        return reply.code(400).send(
          jsonRpcError(
            rpc.id ?? null,
            -32020,
            headerError
          )
        );
      }

      if (rpc.method === "server/discover") {
        return jsonRpcResult(
          rpc.id,
          {
            resultType: "complete",
            supportedVersions: [
              MODERN_MCP_VERSION,
              LEGACY_MCP_VERSION
            ],
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: "oeap-ai-action-hub",
              version: "1.0.0"
            },
            instructions:
              "Call enabled Universal Actions. R2/R3 tools return an approval_required result and execute only after enterprise approval.",
            ttlMs: 30_000,
            cacheScope: "private"
          }
        );
      }

      if (rpc.method === "initialize") {
        return jsonRpcResult(
          rpc.id,
          {
            protocolVersion: LEGACY_MCP_VERSION,
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: "oeap-ai-action-hub",
              version: "1.0.0"
            },
            instructions:
              "OEAP Universal Actions over MCP."
          }
        );
      }

      if (
        rpc.method === "notifications/initialized"
      ) {
        return reply.code(202).send();
      }

      if (rpc.method === "tools/list") {
        const actions = store.listActions(
          identity.organizationId
        ).filter((item) => item.enabled);

        return jsonRpcResult(
          rpc.id,
          {
            resultType: "complete",
            tools: actions.map((action) =>
              compileUniversalAction(
                action,
                "mcp"
              ).artifact
            ),
            ttlMs: 30_000,
            cacheScope: "private"
          }
        );
      }

      if (rpc.method === "tools/call") {
        const params = isRecord(rpc.params)
          ? rpc.params
          : {};
        const name =
          typeof params.name === "string"
            ? params.name
            : "";

        if (!name) {
          return reply.code(400).send(
            jsonRpcError(
              rpc.id,
              -32602,
              "tools/call requires params.name"
            )
          );
        }

        const result = await requestActionExecution({
          store,
          repoRoot: input.repoRoot,
          openEnterpriseRoot: input.openEnterpriseRoot,
          organizationId: identity.organizationId,
          memberId: identity.memberId,
          actionId: name,
          payload:
            params.arguments === undefined
              ? {}
              : params.arguments
        });

        if (result.httpStatus >= 400) {
          return jsonRpcResult(
            rpc.id,
            {
              resultType: "complete",
              isError: true,
              content: [
                {
                  type: "text",
                  text:
                    typeof result.body.error === "string"
                      ? result.body.error
                      : "Action execution failed"
                }
              ],
              structuredContent: result.body
            }
          );
        }

        return jsonRpcResult(
          rpc.id,
          {
            resultType: "complete",
            content: [
              {
                type: "text",
                text:
                  result.body.status === "approval_required"
                    ? "Approval required before this action can execute."
                    : "Action completed."
              }
            ],
            structuredContent: result.body
          }
        );
      }

      return reply.code(404).send(
        jsonRpcError(
          rpc.id ?? null,
          -32601,
          "Method not found"
        )
      );
    }
  );
}

async function requestActionExecution(input: {
  store: ActionHubStore;
  repoRoot: string;
  openEnterpriseRoot: string;
  organizationId: string;
  memberId: string;
  actionId: string;
  payload: unknown;
  preferredProvider?: string;
}): Promise<{
  httpStatus: number;
  body: Record<string, unknown>;
}> {
  const action = input.store.getAction(
    input.organizationId,
    input.actionId
  );

  if (!action) {
    return {
      httpStatus: 404,
      body: {
        ok: false,
        error: "Action not found"
      }
    };
  }

  if (!action.enabled) {
    return {
      httpStatus: 409,
      body: {
        ok: false,
        error: "Action is disabled"
      }
    };
  }

  const validation = validateUniversalActionInput(
    action,
    input.payload
  );

  if (!validation.ok) {
    return {
      httpStatus: 422,
      body: {
        ok: false,
        error: "Action input validation failed",
        details: validation.errors
      }
    };
  }

  const policy = actionPolicy(action.risk);

  if (policy.approvalRequired) {
    const approval = input.store.createApproval({
      organizationId: input.organizationId,
      memberId: input.memberId,
      action,
      payload: input.payload,
      preferredProvider: input.preferredProvider
    });

    input.store.recordEvent({
      organizationId: input.organizationId,
      memberId: input.memberId,
      actionId: action.id,
      status: "approval_required",
      approvalId: approval.id
    });

    return {
      httpStatus: 202,
      body: {
        ok: true,
        status: "approval_required",
        approval,
        confirmationRequired:
          policy.explicitConfirmationRequired,
        confirmationValue:
          policy.explicitConfirmationRequired
            ? action.id
            : undefined
      }
    };
  }

  const result = await executeAction({
    store: input.store,
    repoRoot: input.repoRoot,
    openEnterpriseRoot: input.openEnterpriseRoot,
    organizationId: input.organizationId,
    memberId: input.memberId,
    action,
    payload: input.payload,
    preferredProvider: input.preferredProvider
  });

  return {
    httpStatus: result.ok ? 200 : 502,
    body: {
      ...result,
      status:
        result.ok
          ? "executed"
          : "failed"
    }
  };
}

async function executeAction(input: {
  store: ActionHubStore;
  repoRoot: string;
  openEnterpriseRoot: string;
  organizationId: string;
  memberId: string;
  action: UniversalActionDefinition;
  payload: unknown;
  preferredProvider?: string;
  approvalId?: string;
}): Promise<{
  ok: boolean;
  output?: unknown;
  error?: string;
  code?: string;
  durationMs: number;
}> {
  const startedAt = Date.now();

  if (input.action.capability === "ai.generate") {
    ensureAIRuntimeProvidersRegistered({
      repoRoot: input.repoRoot,
      openEnterpriseRoot: input.openEnterpriseRoot
    });
  }

  try {
    const execution = await connectorRuntime.invoke({
      capability: input.action.capability,
      input: input.payload,
      preferredProvider: input.preferredProvider,
      context: {
        workspaceId: input.organizationId,
        userId: input.memberId,
        taskId:
          `action-hub:${input.action.id}:${Date.now()}`,
        metadata: {
          actionId: input.action.id,
          risk: input.action.risk,
          approvalId: input.approvalId
        }
      }
    });
    const durationMs = Date.now() - startedAt;

    if (!execution.ok) {
      const error =
        execution.error?.message ||
        "Connector execution failed";

      input.store.recordEvent({
        organizationId: input.organizationId,
        memberId: input.memberId,
        actionId: input.action.id,
        status: "failed",
        durationMs,
        approvalId: input.approvalId,
        error
      });

      return {
        ok: false,
        error,
        code: execution.error?.code,
        durationMs
      };
    }

    input.store.recordEvent({
      organizationId: input.organizationId,
      memberId: input.memberId,
      actionId: input.action.id,
      status: "success",
      durationMs,
      approvalId: input.approvalId
    });

    return {
      ok: true,
      output: execution.output,
      durationMs
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = errorMessage(error);

    input.store.recordEvent({
      organizationId: input.organizationId,
      memberId: input.memberId,
      actionId: input.action.id,
      status: "failed",
      durationMs,
      approvalId: input.approvalId,
      error: message
    });

    return {
      ok: false,
      error: message,
      code: "ACTION_EXECUTION_ERROR",
      durationMs
    };
  }
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

function validApprovalStatus(
  value?: string
): ActionHubApprovalStatus | undefined {
  return [
    "pending",
    "approved",
    "rejected",
    "executed",
    "failed",
    "cancelled"
  ].includes(value || "")
    ? value as ActionHubApprovalStatus
    : undefined;
}

function publicBaseUrl(
  request: FastifyRequest
): string {
  const forwardedProto =
    request.headers["x-forwarded-proto"];
  const proto =
    typeof forwardedProto === "string"
      ? forwardedProto.split(",")[0]?.trim()
      : undefined;
  const forwardedHost =
    request.headers["x-forwarded-host"];
  const host =
    typeof forwardedHost === "string"
      ? forwardedHost.split(",")[0]?.trim()
      : request.headers.host;

  return `${proto || request.protocol || "http"}://${host || "127.0.0.1:8787"}`;
}

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

function jsonRpcResult(
  id: JsonRpcRequest["id"],
  result: unknown
) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result
  };
}

function jsonRpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string
) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message
    }
  };
}

function validateMcpHeaders(
  request: FastifyRequest,
  rpc: JsonRpcRequest
): string | undefined {
  const protocolHeader =
    request.headers["mcp-protocol-version"];
  const methodHeader =
    request.headers["mcp-method"];
  const nameHeader =
    request.headers["mcp-name"];
  const params = isRecord(rpc.params)
    ? rpc.params
    : {};
  const meta = isRecord(params._meta)
    ? params._meta
    : {};
  const modern =
    protocolHeader === MODERN_MCP_VERSION ||
    meta["io.modelcontextprotocol/protocolVersion"] === MODERN_MCP_VERSION;

  if (!modern) {
    return undefined;
  }

  if (protocolHeader !== MODERN_MCP_VERSION) {
    return `MCP-Protocol-Version must be ${MODERN_MCP_VERSION}`;
  }

  if (methodHeader !== rpc.method) {
    return "Mcp-Method header must match JSON-RPC method";
  }

  if (
    (rpc.method === "tools/call") &&
    (
      typeof params.name !== "string" ||
      nameHeader !== params.name
    )
  ) {
    return "Mcp-Name header must match params.name";
  }

  return undefined;
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Action Hub operation failed";
}
