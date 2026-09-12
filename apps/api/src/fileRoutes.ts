import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { join } from "node:path";

import {
  EnterpriseFileStore
} from "./fileStore.js";
import {
  TenancyStore
} from "./tenancyStore.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";

export function registerFileRoutes(input: {
  app: FastifyInstance;
  repoRoot: string;
}) {
  const runtimeRoot = join(
    input.repoRoot,
    ".tmp"
  );
  const tenancy = new TenancyStore(
    join(
      runtimeRoot,
      "tenancy",
      "tenancy.sqlite"
    )
  );
  const files = new EnterpriseFileStore(
    join(
      runtimeRoot,
      "files",
      "files.sqlite"
    ),
    join(runtimeRoot, "files", "objects")
  );

  input.app.get<{
    Querystring: {
      appId?: string;
      limit?: string;
    };
  }>(
    "/api/files",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "data.read",
        request.query.appId
      );
      if (!identity) return;

      return {
        ok: true,
        files: files.list({
          organizationId: identity.organizationId,
          appId: request.query.appId?.trim() || undefined,
          limit: Number(request.query.limit || 100) || 100
        })
      };
    }
  );

  input.app.post<{
    Body: {
      name?: string;
      mimeType?: string;
      contentBase64?: string;
      appId?: string;
    };
  }>(
    "/api/files",
    async (request, reply) => {
      const body = request.body ?? {};
      const appId = body.appId?.trim() || undefined;
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "data.write",
        appId
      );
      if (!identity) return;

      const name = body.name?.trim();
      const encoded = body.contentBase64?.trim();

      if (!name || !encoded) {
        return reply.code(400).send({
          ok: false,
          error: "name and contentBase64 are required"
        });
      }

      let bytes: Buffer;

      try {
        bytes = Buffer.from(encoded, "base64");
      } catch {
        return reply.code(400).send({
          ok: false,
          error: "contentBase64 is invalid"
        });
      }

      if (
        bytes.length === 0 ||
        normalizeBase64(bytes.toString("base64")) !==
          normalizeBase64(encoded)
      ) {
        return reply.code(400).send({
          ok: false,
          error: "contentBase64 is invalid"
        });
      }

      const maximumBytes = maxFileBytes();
      if (bytes.length > maximumBytes) {
        return reply.code(413).send({
          ok: false,
          error:
            `File exceeds ${Math.round(maximumBytes / 1024 / 1024)} MB limit`
        });
      }

      const file = files.create({
        organizationId: identity.organizationId,
        appId,
        uploadedBy: identity.memberId,
        name,
        mimeType: body.mimeType,
        bytes
      });

      return {
        ok: true,
        file,
        downloadUrl:
          `/api/files/${encodeURIComponent(file.id)}/content`
      };
    }
  );

  input.app.get<{
    Params: { fileId: string };
  }>(
    "/api/files/:fileId",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "data.read"
      );
      if (!identity) return;

      const file = files.get(
        identity.organizationId,
        request.params.fileId
      );

      if (!file) {
        return reply.code(404).send({
          ok: false,
          error: "File not found"
        });
      }

      if (
        file.appId &&
        !authorize(
          tenancy,
          identity.organizationId,
          identity.memberId,
          "data.read",
          file.appId
        )
      ) {
        return forbidden(reply);
      }

      return { ok: true, file };
    }
  );

  input.app.get<{
    Params: { fileId: string };
  }>(
    "/api/files/:fileId/content",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "data.read"
      );
      if (!identity) return;

      const result = files.read(
        identity.organizationId,
        request.params.fileId
      );

      if (!result) {
        return reply.code(404).send({
          ok: false,
          error: "File not found"
        });
      }

      if (
        result.metadata.appId &&
        !authorize(
          tenancy,
          identity.organizationId,
          identity.memberId,
          "data.read",
          result.metadata.appId
        )
      ) {
        return forbidden(reply);
      }

      reply.header(
        "Content-Type",
        result.metadata.mimeType ||
          "application/octet-stream"
      );
      reply.header(
        "Content-Length",
        String(result.bytes.length)
      );
      reply.header(
        "Content-Disposition",
        contentDisposition(result.metadata.name)
      );
      reply.header(
        "X-Content-Type-Options",
        "nosniff"
      );

      return reply.send(result.bytes);
    }
  );

  input.app.delete<{
    Params: { fileId: string };
  }>(
    "/api/files/:fileId",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "data.write"
      );
      if (!identity) return;

      const metadata = files.get(
        identity.organizationId,
        request.params.fileId
      );

      if (!metadata) {
        return reply.code(404).send({
          ok: false,
          error: "File not found"
        });
      }

      if (
        metadata.appId &&
        !authorize(
          tenancy,
          identity.organizationId,
          identity.memberId,
          "data.write",
          metadata.appId
        )
      ) {
        return forbidden(reply);
      }

      files.delete(
        identity.organizationId,
        request.params.fileId
      );

      return { ok: true };
    }
  );
}

function requirePermission(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string,
  appId?: string
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
    permission,
    appId
  )) {
    return forbidden(reply);
  }

  return { organizationId, memberId };
}

function authorize(
  tenancy: TenancyStore,
  organizationId: string,
  memberId: string,
  permission: string,
  appId?: string
): boolean {
  try {
    return tenancy.authorize({
      organizationId,
      memberId,
      permission,
      appId
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

function maxFileBytes(): number {
  const mb = Number(process.env.OEAP_MAX_FILE_MB || 10);
  const normalized =
    Number.isFinite(mb) && mb > 0
      ? Math.min(mb, 25)
      : 10;
  return Math.floor(normalized * 1024 * 1024);
}

function normalizeBase64(value: string): string {
  return value
    .replace(/^data:[^,]*,/, "")
    .replace(/\s+/g, "")
    .replace(/=+$/, "");
}

function contentDisposition(name: string): string {
  const fallback = name
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(0, 120) || "download";
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
