import type {
  FastifyInstance
} from "fastify";

import {
  packageManager
} from "@oeap/package-manager";

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
                  ? "enabled"
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
