import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import { runtimePath } from "./runtimePaths.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";
import { TenancyStore } from "./tenancyStore.js";

export interface AppLifecycleRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
  loadApps: (organizationId?: string) => Promise<any[]>;
}

type LifecycleMarker = {
  appId: string;
  originalDirectory: string;
  archivedAt: string;
  archivedBy: string;
};

type Identity = {
  organizationId: string;
  memberId: string;
};

export function registerAppLifecycleRoutes(
  options: AppLifecycleRoutesOptions
) {
  const {
    app,
    repoRoot,
    loadApps
  } = options;

  const tenancy = new TenancyStore(
    runtimePath(repoRoot, "tenancy", "tenancy.sqlite")
  );

  app.get(
    "/api/apps-archive",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "apps.manage"
      );
      if (!identity) return;

      return {
        ok: true,
        organizationId: identity.organizationId,
        apps: await listArchivedApps(
          repoRoot,
          identity.organizationId
        )
      };
    }
  );

  app.post<{
    Params: { appId: string };
  }>(
    "/api/apps/:appId/archive",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "apps.manage",
        request.params.appId
      );
      if (!identity) return;

      const manifest = (await loadApps(identity.organizationId))
        .find((item) => item.id === request.params.appId);

      if (!manifest?.localDirectory) {
        return reply.code(404).send({
          ok: false,
          error: "Active app not found"
        });
      }

      const source = join(
        activeRoot(repoRoot, identity.organizationId),
        safeDirectory(manifest.localDirectory)
      );
      const archive = archiveDirectory(
        repoRoot,
        identity.organizationId,
        request.params.appId
      );

      if (await exists(archive)) {
        return reply.code(409).send({
          ok: false,
          error:
            "An archived copy already exists. Restore or remove that archive before archiving again."
        });
      }

      await mkdir(
        archivedRoot(repoRoot, identity.organizationId),
        { recursive: true }
      );

      const marker: LifecycleMarker = {
        appId: request.params.appId,
        originalDirectory: safeDirectory(manifest.localDirectory),
        archivedAt: new Date().toISOString(),
        archivedBy: identity.memberId
      };

      await writeFile(
        join(source, "app.lifecycle.json"),
        JSON.stringify(marker, null, 2),
        "utf8"
      );

      try {
        await rename(source, archive);
      } catch (error) {
        await rm(
          join(source, "app.lifecycle.json"),
          { force: true }
        ).catch(() => undefined);

        return reply.code(500).send({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "App archive failed"
        });
      }

      return {
        ok: true,
        app: {
          id: manifest.id,
          displayName:
            manifest.displayName ?? manifest.name,
          version: manifest.version,
          archivedAt: marker.archivedAt
        }
      };
    }
  );

  app.post<{
    Params: { appId: string };
  }>(
    "/api/apps-archive/:appId/restore",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "apps.manage"
      );
      if (!identity) return;

      const archive = archiveDirectory(
        repoRoot,
        identity.organizationId,
        request.params.appId
      );

      if (!await exists(archive)) {
        return reply.code(404).send({
          ok: false,
          error: "Archived app not found"
        });
      }

      const marker = await readMarker(archive);
      if (marker.appId !== request.params.appId) {
        return reply.code(409).send({
          ok: false,
          error: "Archived app identity does not match request"
        });
      }

      const destination = join(
        activeRoot(repoRoot, identity.organizationId),
        safeDirectory(marker.originalDirectory)
      );

      if (await exists(destination)) {
        return reply.code(409).send({
          ok: false,
          error: "An active app already occupies the restore destination"
        });
      }

      await mkdir(
        activeRoot(repoRoot, identity.organizationId),
        { recursive: true }
      );
      await rename(archive, destination);
      await rm(
        join(destination, "app.lifecycle.json"),
        { force: true }
      );

      try {
        tenancy.grantMemberAppAccess(
          identity.memberId,
          request.params.appId,
          identity.memberId
        );
      } catch {
        // Wildcard owners already have access to every application.
      }

      const restored = (await loadApps(identity.organizationId))
        .find((item) => item.id === request.params.appId);

      if (!restored) {
        await rename(destination, archive).catch(() => undefined);
        return reply.code(500).send({
          ok: false,
          error: "Restored app could not be loaded; archive was preserved"
        });
      }

      return {
        ok: true,
        app: restored
      };
    }
  );
}

async function listArchivedApps(
  repoRoot: string,
  organizationId: string
) {
  const root = archivedRoot(repoRoot, organizationId);

  try {
    const entries = await readdir(root, {
      withFileTypes: true
    });
    const result: any[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const directory = join(root, entry.name);

      try {
        const [manifestRaw, marker] = await Promise.all([
          readFile(
            join(directory, "oeap.package.json"),
            "utf8"
          ),
          readMarker(directory)
        ]);
        const manifest = JSON.parse(manifestRaw);

        if (manifest.id !== marker.appId) continue;

        result.push({
          id: manifest.id,
          name: manifest.name,
          displayName:
            manifest.displayName ?? manifest.name,
          description: manifest.description,
          version: manifest.version,
          publisher: manifest.publisher,
          archivedAt: marker.archivedAt,
          archivedBy: marker.archivedBy,
          originalDirectory: marker.originalDirectory
        });
      } catch {
        // Ignore incomplete/corrupt archive directories instead of exposing them.
      }
    }

    return result.sort((a, b) =>
      String(b.archivedAt).localeCompare(String(a.archivedAt))
    );
  } catch {
    return [];
  }
}

async function readMarker(
  directory: string
): Promise<LifecycleMarker> {
  const raw = await readFile(
    join(directory, "app.lifecycle.json"),
    "utf8"
  );
  const parsed = JSON.parse(raw) as Partial<LifecycleMarker>;

  if (
    typeof parsed.appId !== "string" ||
    typeof parsed.originalDirectory !== "string" ||
    typeof parsed.archivedAt !== "string" ||
    typeof parsed.archivedBy !== "string"
  ) {
    throw new Error("Archived app lifecycle marker is invalid");
  }

  return {
    appId: parsed.appId,
    originalDirectory: safeDirectory(parsed.originalDirectory),
    archivedAt: parsed.archivedAt,
    archivedBy: parsed.archivedBy
  };
}

function activeRoot(
  repoRoot: string,
  organizationId: string
): string {
  return organizationId === "org_local"
    ? runtimePath(repoRoot, "generated-apps")
    : runtimePath(
        repoRoot,
        "organizations",
        safeIdentifier(organizationId),
        "generated-apps"
      );
}

function archivedRoot(
  repoRoot: string,
  organizationId: string
): string {
  return organizationId === "org_local"
    ? runtimePath(repoRoot, "archived-apps")
    : runtimePath(
        repoRoot,
        "organizations",
        safeIdentifier(organizationId),
        "archived-apps"
      );
}

function archiveDirectory(
  repoRoot: string,
  organizationId: string,
  appId: string
): string {
  return join(
    archivedRoot(repoRoot, organizationId),
    safeIdentifier(appId)
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function safeDirectory(value: unknown): string {
  const normalized = String(value).trim();

  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0")
  ) {
    throw new Error("Invalid app directory name");
  }

  return normalized;
}

function safeIdentifier(value: unknown): string {
  return String(value).replace(
    /[^A-Za-z0-9_.-]/g,
    "_"
  );
}

function requirePermission(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string,
  appId?: string
): Identity | undefined {
  const identity = {
    organizationId: organizationFrom(request),
    memberId: memberFrom(request)
  };

  try {
    if (!tenancy.authorize({
      ...identity,
      permission,
      appId
    })) {
      return forbidden(reply);
    }
  } catch {
    return forbidden(reply);
  }

  return identity;
}

function forbidden(reply: FastifyReply) {
  reply.code(403).send({
    ok: false,
    error: "Forbidden"
  });
  return undefined;
}
