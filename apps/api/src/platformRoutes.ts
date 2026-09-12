import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  packageManager,
  type PackageRuntimeModule
} from "@oeap/package-manager";
import { AppDatabase } from "@oeap/data-runtime";

import {
  createDeveloperPackage,
  deleteDeveloperPackage,
  discoverOfficialPackages,
  listDeveloperPackages,
  listPublishedPackages,
  publishDeveloperPackage,
  unpublishDeveloperPackage,
  validateDeveloperPackage,
  type DeveloperPackageInput,
  type MarketplacePackage,
  type PlatformPackageType
} from "./platformCatalog.js";
import { OrganizationPackageStore } from "./orgPackageStore.js";
import { TenancyStore } from "./tenancyStore.js";
import { memberFrom, organizationFrom } from "./tenancyRoutes.js";
import { runtimePath } from "./runtimePaths.js";

export interface PlatformRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
  loadApps: (organizationId?: string) => Promise<any[]>;
}

type Identity = {
  organizationId: string;
  memberId: string;
};

export function registerPlatformRoutes(
  options: PlatformRoutesOptions
) {
  const { app, repoRoot, loadApps } = options;
  const tenancy = new TenancyStore(
    runtimePath(repoRoot, "tenancy", "tenancy.sqlite")
  );
  const organizationPackages = new OrganizationPackageStore(
    runtimePath(repoRoot, "packages", "organization-packages.sqlite")
  );

  async function loadOfficialRuntimeModule(
    packageId: string
  ): Promise<PackageRuntimeModule> {
    const official = await discoverOfficialPackages(repoRoot);
    const found = official.find((item) => item.id === packageId);

    if (!found?.directory) {
      throw new Error(`Official package not found: ${packageId}`);
    }

    const modulePath = join(
      repoRoot,
      found.directory,
      "dist",
      "index.js"
    );
    const imported = await import(pathToFileURL(modulePath).href);
    const runtimeModule = imported.packageModule as
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
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.read"
      );
      if (!identity) return;

      const [official, developer, published, apps] = await Promise.all([
        discoverOfficialPackages(repoRoot),
        listDeveloperPackages(repoRoot, identity.organizationId),
        listPublishedPackages(repoRoot, identity.organizationId),
        loadApps(identity.organizationId)
      ]);

      const generated: MarketplacePackage[] = apps
        .filter((item) =>
          can(tenancy, identity, "apps.read", item.id)
        )
        .map((item) => ({
          id: item.id,
          type: "app",
          name: item.name,
          displayName: item.displayName ?? item.name,
          description: item.description,
          version: item.version ?? "0.0.1",
          publisher: item.publisher ?? "local",
          source: "generated",
          status: "enabled",
          directory: item.localDirectory,
          tags: ["app", "generated"]
        }));

      const packages = [
        ...official.map((item) => ({
          ...item,
          status:
            organizationPackages.get(identity.organizationId, item.id) === "enabled"
              ? "enabled" as const
              : "available" as const
        })),
        ...generated,
        ...developer,
        ...published
      ];

      const counts = packages
        .filter((item) => item.status !== "draft")
        .reduce((acc, item) => {
          acc[item.type] = (acc[item.type] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>);

      return {
        ok: true,
        organizationId: identity.organizationId,
        packages,
        counts,
        runtime: organizationPackages.list(identity.organizationId)
      };
    }
  );

  app.post<{
    Params: { packageId: string };
  }>(
    "/api/platform/packages/:packageId/enable",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      const packageId = request.params.packageId;

      try {
        if (!packageManager.get(packageId)) {
          const runtimeModule = await loadOfficialRuntimeModule(packageId);
          await packageManager.install(runtimeModule);
        }

        if (!packageManager.isEnabled(packageId)) {
          await packageManager.enable(packageId);
        }

        organizationPackages.set(
          identity.organizationId,
          packageId,
          "enabled"
        );

        return {
          ok: true,
          package: {
            id: packageId,
            status: "enabled",
            organizationId: identity.organizationId
          }
        };
      } catch (error) {
        return reply.code(400).send({
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
    Params: { packageId: string };
  }>(
    "/api/platform/packages/:packageId/disable",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      const packageId = request.params.packageId;
      organizationPackages.set(
        identity.organizationId,
        packageId,
        "disabled"
      );

      if (
        organizationPackages.countEnabled(packageId) === 0 &&
        packageManager.isEnabled(packageId)
      ) {
        await packageManager.disable(packageId);
      }

      return {
        ok: true,
        package: {
          id: packageId,
          status: "disabled",
          organizationId: identity.organizationId
        }
      };
    }
  );

  app.get(
    "/api/platform/data-overview",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "data.read"
      );
      if (!identity) return;

      const apps = (await loadApps(identity.organizationId)).filter(
        (manifest) =>
          can(tenancy, identity, "apps.read", manifest.id) &&
          can(tenancy, identity, "data.read", manifest.id)
      );

      const summaries = apps.map((manifest) => {
        const safeId = safeIdentifier(manifest.id);
        const safeOrganizationId = safeIdentifier(identity.organizationId);
        const databaseFile =
          identity.organizationId === "org_local"
            ? `${safeId}.sqlite`
            : `${safeOrganizationId}__${safeId}.sqlite`;

        const database = new AppDatabase(
          runtimePath(repoRoot, "databases", databaseFile)
        );
        const entities = manifest.metadata?.entities ?? [];

        database.ensureEntities(
          entities.map((entity: any) => ({
            name: entity.name,
            fields: entity.fields ?? []
          }))
        );

        const entityStats = entities.map((entity: any) => ({
          name: entity.name,
          description: entity.description,
          fields: entity.fields?.length ?? 0,
          records: database.count(entity.name)
        }));

        return {
          id: manifest.id,
          name: manifest.displayName ?? manifest.name,
          version: manifest.version,
          entities: entityStats.length,
          records: entityStats.reduce(
            (total: number, item: any) => total + item.records,
            0
          ),
          entityStats
        };
      });

      return {
        ok: true,
        organizationId: identity.organizationId,
        apps: summaries,
        totals: {
          apps: summaries.length,
          entities: summaries.reduce(
            (total, item) => total + item.entities,
            0
          ),
          records: summaries.reduce(
            (total, item) => total + item.records,
            0
          )
        }
      };
    }
  );

  app.get(
    "/api/developer/packages",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.read"
      );
      if (!identity) return;

      return {
        ok: true,
        packages: await listDeveloperPackages(
          repoRoot,
          identity.organizationId
        ),
        published: await listPublishedPackages(
          repoRoot,
          identity.organizationId
        )
      };
    }
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
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      const body = request.body ?? {};

      if (
        !body.type ||
        !isPackageType(body.type) ||
        !body.name?.trim()
      ) {
        return reply.code(400).send({
          ok: false,
          error: "type and name are required"
        });
      }

      const packageInput: DeveloperPackageInput = {
        type: body.type,
        name: body.name,
        displayName: body.displayName,
        description: body.description,
        publisher: body.publisher
      };

      const created = await createDeveloperPackage(
        repoRoot,
        packageInput,
        identity.organizationId
      );

      return {
        ok: true,
        package: created
      };
    }
  );

  app.post<{
    Params: { packageId: string };
  }>(
    "/api/developer/packages/:packageId/validate",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      const validation = await validateDeveloperPackage(
        repoRoot,
        request.params.packageId,
        identity.organizationId
      );

      return {
        ok: validation.valid,
        ...validation
      };
    }
  );

  app.post<{
    Params: { packageId: string };
  }>(
    "/api/developer/packages/:packageId/publish",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      try {
        const published = await publishDeveloperPackage(
          repoRoot,
          request.params.packageId,
          identity.organizationId
        );

        return {
          ok: true,
          package: published,
          channel: "local-marketplace"
        };
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Publish failed"
        });
      }
    }
  );

  app.delete<{
    Params: { packageId: string };
  }>(
    "/api/developer/packages/:packageId/publish",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      const deleted = await unpublishDeveloperPackage(
        repoRoot,
        request.params.packageId,
        identity.organizationId
      );

      if (!deleted) {
        return reply.code(404).send({
          ok: false,
          error: "Published package not found"
        });
      }

      return { ok: true };
    }
  );

  app.delete<{
    Params: { packageId: string };
  }>(
    "/api/developer/packages/:packageId",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      const deleted = await deleteDeveloperPackage(
        repoRoot,
        request.params.packageId,
        identity.organizationId
      );

      if (!deleted) {
        return reply.code(404).send({
          ok: false,
          error: "Developer package not found"
        });
      }

      return { ok: true };
    }
  );
}

function requirePermission(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string
): Identity | undefined {
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

function can(
  tenancy: TenancyStore,
  identity: Identity,
  permission: string,
  appId?: string
): boolean {
  try {
    return tenancy.authorize({
      organizationId: identity.organizationId,
      memberId: identity.memberId,
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

function safeIdentifier(value: unknown): string {
  return String(value).replace(
    /[^A-Za-z0-9_.-]/g,
    "_"
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
