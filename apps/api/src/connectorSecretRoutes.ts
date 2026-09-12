import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ConnectorSecretStore } from "./connectorSecretStore.js";
import { TenancyStore } from "./tenancyStore.js";
import { organizationFrom, memberFrom } from "./tenancyRoutes.js";
import { runtimePath } from "./runtimePaths.js";

export function registerConnectorSecretRoutes(input: {
  app: FastifyInstance;
  repoRoot: string;
}) {
  const store = new ConnectorSecretStore(
    runtimePath(input.repoRoot, "settings", "connector-secrets.enc"),
    runtimePath(input.repoRoot, "settings", "connector-secrets.key")
  );
  const tenancy = new TenancyStore(
    runtimePath(input.repoRoot, "tenancy", "tenancy.sqlite")
  );

  input.app.get("/api/connectors/credentials", async (request, reply) => {
    const identity = requireManage(tenancy, request, reply);
    if (!identity) return;
    return { ok: true, credentials: store.list(identity.organizationId) };
  });

  input.app.get<{
    Params: { connectorId: string };
  }>("/api/connectors/:connectorId/credentials", async (request, reply) => {
    const identity = requireManage(tenancy, request, reply);
    if (!identity) return;
    return {
      ok: true,
      credential: store.publicView(identity.organizationId, request.params.connectorId)
    };
  });

  input.app.put<{
    Params: { connectorId: string };
    Body: {
      values?: Record<string, string>;
      clear?: string[];
    };
  }>("/api/connectors/:connectorId/credentials", async (request, reply) => {
    const identity = requireManage(tenancy, request, reply);
    if (!identity) return;

    const connectorId = request.params.connectorId.trim();
    if (!connectorId) {
      return reply.code(400).send({ ok: false, error: "connectorId is required" });
    }

    try {
      return {
        ok: true,
        credential: store.update(
          identity.organizationId,
          connectorId,
          request.body?.values ?? {},
          request.body?.clear ?? []
        )
      };
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        error: error instanceof Error ? error.message : "Credential update failed"
      });
    }
  });

  input.app.delete<{
    Params: { connectorId: string };
  }>("/api/connectors/:connectorId/credentials", async (request, reply) => {
    const identity = requireManage(tenancy, request, reply);
    if (!identity) return;
    return {
      ok: true,
      deleted: store.delete(identity.organizationId, request.params.connectorId)
    };
  });

  return store;
}

function requireManage(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply
): { organizationId: string; memberId: string } | undefined {
  const organizationId = organizationFrom(request);
  const memberId = memberFrom(request);
  try {
    if (!tenancy.authorize({ organizationId, memberId, permission: "packages.manage" })) {
      return forbidden(reply);
    }
  } catch {
    return forbidden(reply);
  }
  return { organizationId, memberId };
}

function forbidden(reply: FastifyReply) {
  reply.code(403).send({ ok: false, error: "Forbidden" });
  return undefined;
}
