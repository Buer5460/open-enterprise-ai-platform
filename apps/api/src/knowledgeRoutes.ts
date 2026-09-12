import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KnowledgeStore } from "./knowledgeStore.js";
import { TenancyStore } from "./tenancyStore.js";
import { organizationFrom, memberFrom } from "./tenancyRoutes.js";
import { runtimePath } from "./runtimePaths.js";

export function registerKnowledgeRoutes(input: {
  app: FastifyInstance;
  repoRoot: string;
}) {
  const store = new KnowledgeStore(
    runtimePath(input.repoRoot, "knowledge", "knowledge.sqlite")
  );
  const tenancy = new TenancyStore(
    runtimePath(input.repoRoot, "tenancy", "tenancy.sqlite")
  );

  input.app.get<{
    Querystring: { appId?: string };
  }>("/api/knowledge/documents", async (request, reply) => {
    const identity = requirePermission(tenancy, request, reply, "data.read", request.query.appId);
    if (!identity) return;
    return {
      ok: true,
      documents: store.list(identity.organizationId, request.query.appId?.trim() || undefined)
    };
  });

  input.app.post<{
    Body: {
      title?: string;
      source?: string;
      text?: string;
      appId?: string;
    };
  }>("/api/knowledge/documents", async (request, reply) => {
    const body = request.body ?? {};
    const appId = body.appId?.trim() || undefined;
    const identity = requirePermission(tenancy, request, reply, "data.write", appId);
    if (!identity) return;

    if (!body.title?.trim() || !body.text?.trim()) {
      return reply.code(400).send({ ok: false, error: "title and text are required" });
    }

    try {
      return {
        ok: true,
        document: store.create({
          organizationId: identity.organizationId,
          appId,
          title: body.title,
          source: body.source,
          text: body.text,
          createdBy: identity.memberId
        })
      };
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        error: error instanceof Error ? error.message : "Knowledge document creation failed"
      });
    }
  });

  input.app.delete<{
    Params: { documentId: string };
  }>("/api/knowledge/documents/:documentId", async (request, reply) => {
    const identity = requirePermission(tenancy, request, reply, "data.write");
    if (!identity) return;
    const deleted = store.delete(identity.organizationId, request.params.documentId);
    if (!deleted) {
      return reply.code(404).send({ ok: false, error: "Knowledge document not found" });
    }
    return { ok: true };
  });

  input.app.post<{
    Body: {
      query?: string;
      appId?: string;
      limit?: number;
      maxCharacters?: number;
    };
  }>("/api/knowledge/search", async (request, reply) => {
    const body = request.body ?? {};
    const appId = body.appId?.trim() || undefined;
    const identity = requirePermission(tenancy, request, reply, "data.read", appId);
    if (!identity) return;

    const query = body.query?.trim();
    if (!query) {
      return reply.code(400).send({ ok: false, error: "query is required" });
    }

    return {
      ok: true,
      ...store.context({
        organizationId: identity.organizationId,
        query,
        appId,
        limit: body.limit,
        maxCharacters: body.maxCharacters
      })
    };
  });
}

function requirePermission(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string,
  appId?: string
): { organizationId: string; memberId: string } | undefined {
  const organizationId = organizationFrom(request);
  const memberId = memberFrom(request);

  try {
    if (!tenancy.authorize({ organizationId, memberId, permission, appId })) {
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
