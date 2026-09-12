import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  publishedPackageDirectory
} from "./platformCatalog.js";
import {
  readPackageProvenance,
  signPackageDirectory,
  verifyPackageDirectory
} from "./packageProvenance.js";
import { TenancyStore } from "./tenancyStore.js";
import { memberFrom, organizationFrom } from "./tenancyRoutes.js";
import { runtimePath } from "./runtimePaths.js";

export function registerPackageProvenanceRoutes(input: {
  app: FastifyInstance;
  repoRoot: string;
}) {
  const tenancy = new TenancyStore(
    runtimePath(input.repoRoot, "tenancy", "tenancy.sqlite")
  );

  input.app.get<{
    Params: { packageId: string };
  }>("/api/developer/packages/:packageId/provenance", async (request, reply) => {
    const identity = requireRead(tenancy, request, reply);
    if (!identity) return;
    const directory = await publishedPackageDirectory(
      input.repoRoot,
      identity.organizationId,
      request.params.packageId
    );
    if (!directory) {
      return reply.code(404).send({
        ok: false,
        error: "Published package not found"
      });
    }
    return {
      ok: true,
      provenance: await readPackageProvenance(directory)
    };
  });

  input.app.post<{
    Params: { packageId: string };
  }>("/api/developer/packages/:packageId/provenance/sign", async (request, reply) => {
    const identity = requireManage(tenancy, request, reply);
    if (!identity) return;
    const directory = await publishedPackageDirectory(
      input.repoRoot,
      identity.organizationId,
      request.params.packageId
    );
    if (!directory) {
      return reply.code(404).send({
        ok: false,
        error: "Published package not found"
      });
    }

    try {
      return {
        ok: true,
        provenance: await signPackageDirectory(
          input.repoRoot,
          directory,
          identity.organizationId
        )
      };
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        error: error instanceof Error
          ? error.message
          : "Package signing failed"
      });
    }
  });

  input.app.post<{
    Params: { packageId: string };
  }>("/api/developer/packages/:packageId/provenance/verify", async (request, reply) => {
    const identity = requireRead(tenancy, request, reply);
    if (!identity) return;
    const directory = await publishedPackageDirectory(
      input.repoRoot,
      identity.organizationId,
      request.params.packageId
    );
    if (!directory) {
      return reply.code(404).send({
        ok: false,
        error: "Published package not found"
      });
    }
    return {
      ok: true,
      ...(await verifyPackageDirectory(
        input.repoRoot,
        directory,
        identity.organizationId
      ))
    };
  });
}

function requireRead(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply
) {
  return requirePermission(tenancy, request, reply, "packages.read");
}

function requireManage(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply
) {
  return requirePermission(tenancy, request, reply, "packages.manage");
}

function requirePermission(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string
): { organizationId: string; memberId: string } | undefined {
  const organizationId = organizationFrom(request);
  const memberId = memberFrom(request);
  try {
    if (!tenancy.authorize({ organizationId, memberId, permission })) {
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
