import type {
  FastifyInstance
} from "fastify";

import {
  join
} from "node:path";

import {
  pathToFileURL
} from "node:url";

import {
  packageManager,
  type PackageRuntimeModule
} from "@oeap/package-manager";

import {
  AppDatabase
} from "@oeap/data-runtime";

import {
  createDeveloperPackage,
  deleteDeveloperPackage,
  discoverOfficialPackages,
  listDeveloperPackages,
  type DeveloperPackageInput,
  type MarketplacePackage,
  type PlatformPackageType
} from "./platformCatalog.js";

export interface PlatformRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
  loadApps: () => Promise<any[]>;
}

export function registerPlatformRoutes(
  options: PlatformRoutesOptions
) {
  const {
    app,
    repoRoot,
    loadApps
  } = options;

  async function loadOfficialRuntimeModule(
    packageId: string
  ): Promise<PackageRuntimeModule> {
    const official =
      await discoverOfficialPackages(
        repoRoot
      );

    const found = official.find(
      (item) => item.id === packageId
    );

    if (!found?.directory) {
      throw new Error(
        `Official package not found: ${packageId}`
      );
    }

    const modulePath = join(
      repoRoot,
      found.directory,
      "dist",
      "index.js"
    );

    const imported = await import(
      pathToFileURL(modulePath).href
    );

    const runtimeModule =
      imported.packageModule as
        | PackageRuntimeModule
        | undefined;

    if (!runtimeModule) {
      throw new Error(
        `${packageId} requires connector/runtime configuration and cannot be toggled automatically yet.`
      );
    }

    return runtimeModule;
  }

  app.get(
    "/api/platform/packages",
    async () => {
      const [
        official,
        developer,
        apps
      ] = await Promise.all([
        discoverOfficialPackages(repoRoot),
        listDeveloperPackages(repoRoot),
        loadApps()
      ]);

      const generated: MarketplacePackage[] =
        apps.map((item) => ({
          id: item.id,
          type: "app",
          name: item.name,
          displayName:
            item.displayName ?? item.name,
          description:
            item.description,
          version:
            item.version ?? "0.0.1",
          publisher:
            item.publisher ?? "local",
          source: "generated",
          status: "enabled",
          directory:
            item.localDirectory,
          tags: ["app", "generated"]
        }));

      const runtime =
        packageManager.list();

      const runtimeStatus =
        new Map(
          runtime.map((item) => [
            item.manifest.id,
            item.status
          ])
        );

      const packages = [
        ...official,
        ...generated,
        ...developer
      ].map((item) => {
        const status =
          runtimeStatus.get(item.id);

        return status
          ? {
              ...item,
              status:
                status === "enabled"
                  ? "enabled" as const
                  : item.status
            }
          : item;
      });

      const counts = packages.reduce(
        (acc, item) => {
          acc[item.type] =
            (acc[item.type] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      return {
        ok: true,
        packages,
        counts,
        runtime: runtime.map(
          (item) => ({
            id: item.manifest.id,
            type: item.manifest.type,
            status: item.status,
            version:
              item.manifest.version,
            installedAt:
              item.installedAt,
            updatedAt:
              item.updatedAt
          })
        )
      };
    }
  );

  app.post<{
    Params: {
      packageId: string;
    };
  }>(
    "/api/platform/packages/:packageId/enable",
    async (request, reply) => {
      const packageId =
        request.params.packageId;

      try {
        if (!packageManager.get(packageId)) {
          const runtimeModule =
            await loadOfficialRuntimeModule(
              packageId
            );

          await packageManager.install(
            runtimeModule
          );
        }

        const installed =
          packageManager.isEnabled(packageId)
            ? packageManager.get(packageId)!
            : await packageManager.enable(
                packageId
              );

        return {
          ok: true,
          package: {
            id: installed.manifest.id,
            type: installed.manifest.type,
            status: installed.status,
            version:
              installed.manifest.version
          }
        };
      } catch (error) {
        return reply
          .code(400)
          .send({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Package enable failed"
          });
      }
    }
  );

  app.post<{
    Params: {
      packageId: string;
    };
  }>(
    "/api/platform/packages/:packageId/disable",
    async (request, reply) => {
      const packageId =
        request.params.packageId;

      const installed =
        packageManager.get(packageId);

      if (!installed) {
        return reply
          .code(404)
          .send({
            ok: false,
            error: "Package not installed"
          });
      }

      const updated =
        installed.status === "enabled"
          ? await packageManager.disable(
              packageId
            )
          : installed;

      return {
        ok: true,
        package: {
          id: updated.manifest.id,
          type: updated.manifest.type,
          status: updated.status,
          version:
            updated.manifest.version
        }
      };
    }
  );

  app.get(
    "/api/platform/data-overview",
    async () => {
      const apps = await loadApps();

      const summaries = apps.map(
        (manifest) => {
          const safeId = String(
            manifest.id
          ).replace(
            /[^a-zA-Z0-9_.-]/g,
            "_"
          );

          const database =
            new AppDatabase(
              join(
                repoRoot,
                ".tmp",
                "databases",
                `${safeId}.sqlite`
              )
            );

          const entities =
            manifest.metadata?.entities ??
            [];

          database.ensureEntities(
            entities.map(
              (entity: any) => ({
                name: entity.name,
                fields:
                  entity.fields ?? []
              })
            )
          );

          const entityStats =
            entities.map(
              (entity: any) => ({
                name: entity.name,
                description:
                  entity.description,
                fields:
                  entity.fields?.length ?? 0,
                records:
                  database.count(
                    entity.name
                  )
              })
            );

          return {
            id: manifest.id,
            name:
              manifest.displayName ??
              manifest.name,
            version:
              manifest.version,
            entities:
              entityStats.length,
            records:
              entityStats.reduce(
                (total: number, item: any) =>
                  total + item.records,
                0
              ),
            entityStats
          };
        }
      );

      return {
        ok: true,
        apps: summaries,
        totals: {
          apps: summaries.length,
          entities:
            summaries.reduce(
              (total, item) =>
                total + item.entities,
              0
            ),
          records:
            summaries.reduce(
              (total, item) =>
                total + item.records,
              0
            )
        }
      };
    }
  );

  app.get(
    "/api/developer/packages",
    async () => ({
      ok: true,
      packages:
        await listDeveloperPackages(
          repoRoot
        )
    })
  );

  app.post<{
    Body: {
      type?: PlatformPackageType;
      name?: string;
      displayName?: string;
      description?: string;
      publisher?: string;
    };
  }>(
    "/api/developer/packages",
    async (request, reply) => {
      const body = request.body ?? {};

      if (
        !body.type ||
        !isPackageType(body.type) ||
        !body.name?.trim()
      ) {
        return reply
          .code(400)
          .send({
            ok: false,
            error:
              "type and name are required"
          });
      }

      const input: DeveloperPackageInput = {
        type: body.type,
        name: body.name,
        displayName:
          body.displayName,
        description:
          body.description,
        publisher:
          body.publisher
      };

      const created =
        await createDeveloperPackage(
          repoRoot,
          input
        );

      return {
        ok: true,
        package: created
      };
    }
  );

  app.delete<{
    Params: {
      packageId: string;
    };
  }>(
    "/api/developer/packages/:packageId",
    async (request, reply) => {
      const deleted =
        await deleteDeveloperPackage(
          repoRoot,
          request.params.packageId
        );

      if (!deleted) {
        return reply
          .code(404)
          .send({
            ok: false,
            error:
              "Developer package not found"
          });
      }

      return {
        ok: true
      };
    }
  );
}

function isPackageType(
  value: string
): value is PlatformPackageType {
  return [
    "app",
    "agent",
    "skill",
    "workflow",
    "connector",
    "data-provider"
  ].includes(value);
}
