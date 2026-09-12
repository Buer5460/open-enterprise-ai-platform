import type {
  FastifyInstance,
  FastifyRequest
} from "fastify";
import {
  readdir,
  readFile
} from "node:fs/promises";
import { join } from "node:path";

import { appPackageBuilder } from "@oeap/app-package-builder";
import type { AppBlueprint } from "@oeap/app-builder";

import { TenancyStore } from "./tenancyStore.js";
import { memberFrom, organizationFrom } from "./tenancyRoutes.js";
import { runtimePath } from "./runtimePaths.js";

export function registerAppHistoryRoutes(input: {
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

  function generatedAppsRoot(
    organizationId: string
  ): string {
    if (organizationId === "org_local") {
      return runtimePath(
        input.repoRoot,
        "generated-apps"
      );
    }

    return runtimePath(
      input.repoRoot,
      "organizations",
      safeIdentifier(organizationId),
      "generated-apps"
    );
  }

  input.app.get<{
    Params: { appId: string };
  }>(
    "/api/apps/:appId/versions",
    async (request, reply) => {
      const organizationId = organizationFrom(request);
      const root = generatedAppsRoot(organizationId);
      const located = await findApp(
        root,
        request.params.appId
      );

      if (!located) {
        return reply.code(404).send({
          ok: false,
          error: "App not found"
        });
      }

      if (!can(
        tenancy,
        request,
        "apps.read",
        request.params.appId
      )) {
        return reply.code(403).send({
          ok: false,
          error: "Forbidden"
        });
      }

      const archived = await listArchivedVersions(
        located.directory
      );

      return {
        ok: true,
        organizationId,
        appId: request.params.appId,
        currentVersion:
          located.manifest.version,
        versions: [
          {
            version: located.manifest.version,
            current: true,
            archivedAt: null,
            displayName:
              located.manifest.displayName ||
              located.manifest.name
          },
          ...archived
        ]
      };
    }
  );

  input.app.get<{
    Params: {
      appId: string;
      version: string;
    };
  }>(
    "/api/apps/:appId/versions/:version",
    async (request, reply) => {
      const organizationId = organizationFrom(request);
      const root = generatedAppsRoot(organizationId);
      const located = await findApp(
        root,
        request.params.appId
      );

      if (!located) {
        return reply.code(404).send({
          ok: false,
          error: "App not found"
        });
      }

      if (!can(
        tenancy,
        request,
        "apps.read",
        request.params.appId
      )) {
        return reply.code(403).send({
          ok: false,
          error: "Forbidden"
        });
      }

      const requested = safeVersion(
        request.params.version
      );
      const current = String(
        located.manifest.version
      );

      const base =
        requested === safeVersion(current)
          ? located.directory
          : join(
              located.directory,
              ".oeap-versions",
              requested
            );

      try {
        const [manifest, blueprint] =
          await Promise.all([
            readJson(
              join(base, "oeap.package.json")
            ),
            readJson(
              join(base, "app.blueprint.json")
            )
          ]);

        return {
          ok: true,
          organizationId,
          current:
            requested === safeVersion(current),
          manifest,
          blueprint
        };
      } catch {
        return reply.code(404).send({
          ok: false,
          error: "Version not found"
        });
      }
    }
  );

  input.app.post<{
    Params: {
      appId: string;
      version: string;
    };
  }>(
    "/api/apps/:appId/versions/:version/restore",
    async (request, reply) => {
      const organizationId = organizationFrom(request);
      const root = generatedAppsRoot(organizationId);
      const located = await findApp(
        root,
        request.params.appId
      );

      if (!located) {
        return reply.code(404).send({
          ok: false,
          error: "App not found"
        });
      }

      if (!can(
        tenancy,
        request,
        "apps.manage",
        request.params.appId
      )) {
        return reply.code(403).send({
          ok: false,
          error: "Forbidden"
        });
      }

      const targetVersion = safeVersion(
        request.params.version
      );
      const currentVersion = String(
        located.manifest.version
      );

      if (
        targetVersion === safeVersion(currentVersion)
      ) {
        return reply.code(400).send({
          ok: false,
          error: "Requested version is already current"
        });
      }

      const historyDirectory = join(
        located.directory,
        ".oeap-versions",
        targetVersion
      );

      let blueprint: AppBlueprint;

      try {
        blueprint = await readJson(
          join(
            historyDirectory,
            "app.blueprint.json"
          )
        ) as AppBlueprint;
      } catch {
        return reply.code(404).send({
          ok: false,
          error: "Archived version not found"
        });
      }

      const nextVersion = bumpPatchVersion(
        currentVersion
      );
      const built = await appPackageBuilder.build({
        blueprint,
        packageId: located.manifest.id,
        publisher:
          located.manifest.publisher || "local",
        version: nextVersion,
        outputDir: root,
        directoryName: located.directoryName
      });

      return {
        ok: true,
        organizationId,
        restoredFrom: request.params.version,
        previousVersion: currentVersion,
        version: nextVersion,
        app: {
          ...built.manifest,
          status: "enabled",
          localDirectory:
            located.directoryName
        }
      };
    }
  );
}

async function findApp(
  generatedAppsRoot: string,
  appId: string
): Promise<{
  directory: string;
  directoryName: string;
  manifest: any;
} | undefined> {
  let entries;

  try {
    entries = await readdir(
      generatedAppsRoot,
      { withFileTypes: true }
    );
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    try {
      const directory = join(
        generatedAppsRoot,
        entry.name
      );
      const manifest = await readJson(
        join(directory, "oeap.package.json")
      );

      if (manifest.id === appId) {
        return {
          directory,
          directoryName: entry.name,
          manifest
        };
      }
    } catch {
      // Ignore malformed generated app directories.
    }
  }

  return undefined;
}

async function listArchivedVersions(
  appDirectory: string
): Promise<Array<{
  version: string;
  current: false;
  archivedAt: string | null;
  displayName?: string;
}>> {
  const root = join(
    appDirectory,
    ".oeap-versions"
  );
  let entries;

  try {
    entries = await readdir(
      root,
      { withFileTypes: true }
    );
  } catch {
    return [];
  }

  const versions = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    try {
      const directory = join(root, entry.name);
      const manifest = await readJson(
        join(directory, "oeap.package.json")
      );
      const archivedAt = await readFile(
        join(directory, "archived-at.txt"),
        "utf8"
      ).catch(() => "");

      versions.push({
        version:
          String(manifest.version || entry.name),
        current: false as const,
        archivedAt:
          archivedAt.trim() || null,
        displayName:
          manifest.displayName || manifest.name
      });
    } catch {
      // Ignore malformed history entries.
    }
  }

  return versions.sort((left, right) =>
    compareVersions(right.version, left.version)
  );
}

function can(
  tenancy: TenancyStore,
  request: FastifyRequest,
  permission: string,
  appId: string
): boolean {
  try {
    return tenancy.authorize({
      organizationId:
        organizationFrom(request),
      memberId:
        memberFrom(request),
      permission,
      appId
    });
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<any> {
  return JSON.parse(
    await readFile(path, "utf8")
  );
}

function bumpPatchVersion(
  version: string
): string {
  const [major, minor, patch] =
    version.split(".").map(
      (part) => Number(part) || 0
    );

  return `${major}.${minor}.${patch + 1}`;
}

function safeVersion(value: string): string {
  return value.replace(/[^0-9A-Za-z_.-]/g, "_");
}

function safeIdentifier(value: unknown): string {
  return String(value).replace(
    /[^A-Za-z0-9_.-]/g,
    "_"
  );
}

function compareVersions(
  left: string,
  right: string
): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);

  for (let index = 0; index < 3; index += 1) {
    const difference =
      (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference;
  }

  return left.localeCompare(right);
}
