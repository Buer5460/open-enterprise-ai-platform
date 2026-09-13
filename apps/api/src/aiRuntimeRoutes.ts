import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

import {
  getAIRuntimePublicSettings,
  getAIRuntimeStatus,
  testAIRuntime,
  updateAIRuntimeSettings
} from "./aiRuntime.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";
import {
  TenancyStore
} from "./tenancyStore.js";
import {
  runtimePath
} from "./runtimePaths.js";

export function registerAIRuntimeRoutes(input: {
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

  input.app.get(
    "/api/ai-runtime/status",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "apps.read"
      );
      if (!identity) return;

      return {
        ok: true,
        organizationId:
          identity.organizationId,
        ai: await getAIRuntimeStatus({
          repoRoot: input.repoRoot,
          openEnterpriseRoot:
            input.openEnterpriseRoot,
          organizationId:
            identity.organizationId
        })
      };
    }
  );

  input.app.get(
    "/api/ai-runtime/settings",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      return {
        ok: true,
        organizationId:
          identity.organizationId,
        settings:
          getAIRuntimePublicSettings(
            input.repoRoot,
            identity.organizationId
          )
      };
    }
  );

  input.app.put<{
    Body: {
      providerMode?: string;
      baseUrl?: string;
      model?: string;
      apiKey?: string;
      timeoutMs?: number;
      clearApiKey?: boolean;
    };
  }>(
    "/api/ai-runtime/settings",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      try {
        const settings = updateAIRuntimeSettings({
          repoRoot: input.repoRoot,
          organizationId:
            identity.organizationId,
          providerMode:
            request.body?.providerMode,
          baseUrl: request.body?.baseUrl,
          model: request.body?.model,
          apiKey: request.body?.apiKey,
          timeoutMs:
            request.body?.timeoutMs,
          clearApiKey:
            request.body?.clearApiKey
        });

        return {
          ok: true,
          settings,
          ai: await getAIRuntimeStatus({
            repoRoot: input.repoRoot,
            openEnterpriseRoot:
              input.openEnterpriseRoot,
            organizationId:
              identity.organizationId
          })
        };
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "AI Runtime settings update failed"
        });
      }
    }
  );

  input.app.post(
    "/api/ai-runtime/test",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "apps.manage"
      );
      if (!identity) return;

      const result = await testAIRuntime({
        repoRoot: input.repoRoot,
        openEnterpriseRoot:
          input.openEnterpriseRoot,
        organizationId:
          identity.organizationId
      });

      return result.ok
        ? result
        : reply.code(503).send(result);
    }
  );

  // Backward-compatible bridge for the Day-1 workbench. Older UI code reads
  // the `ai` field from /api/usability/status; keep that contract while the
  // actual provider is now resolved by the unified tenant AI Runtime manager.
  input.app.addHook(
    "onSend",
    async (request, reply, payload) => {
      const path = request.url.split("?", 1)[0];
      if (
        path !== "/api/usability/status" ||
        reply.statusCode >= 400
      ) {
        return payload;
      }

      const text = Buffer.isBuffer(payload)
        ? payload.toString("utf8")
        : typeof payload === "string"
          ? payload
          : undefined;

      if (!text) return payload;

      try {
        const parsed = JSON.parse(text) as
          Record<string, unknown>;
        parsed.ai = await getAIRuntimeStatus({
          repoRoot: input.repoRoot,
          openEnterpriseRoot:
            input.openEnterpriseRoot,
          organizationId:
            organizationFrom(request)
        });
        return JSON.stringify(parsed);
      } catch {
        return payload;
      }
    }
  );
}

function requirePermission(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string
): {
  organizationId: string;
  memberId: string;
} | undefined {
  const identity = {
    organizationId: organizationFrom(request),
    memberId: memberFrom(request)
  };

  try {
    if (!tenancy.authorize({
      ...identity,
      permission
    })) {
      return forbidden(reply);
    }
  } catch {
    return forbidden(reply);
  }

  return identity;
}

function forbidden(
  reply: FastifyReply
) {
  reply.code(403).send({
    ok: false,
    error: "Forbidden"
  });
  return undefined;
}
