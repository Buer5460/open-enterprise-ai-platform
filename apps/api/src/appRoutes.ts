import type {
  FastifyInstance,
  FastifyRequest
} from "fastify";

import {
  readdir,
  readFile
} from "node:fs/promises";

import {
  join
} from "node:path";

import {
  permissionEngine
} from "@oeap/permission-engine";

import {
  packageManager
} from "@oeap/package-manager";

import {
  registerDeepSeekHarnessConnector
} from "@oeap/deepseek-harness-connector";

import {
  packageModule as aiSkillPackage
} from "@oeap/ai-generate-skill";

import {
  appBuilder,
  type AppBlueprint
} from "@oeap/app-builder";

import {
  appPackageBuilder
} from "@oeap/app-package-builder";

import {
  AppDatabase
} from "@oeap/data-runtime";

import {
  TenancyStore
} from "./tenancyStore.js";

import {
  organizationFrom,
  memberFrom
} from "./tenancyRoutes.js";

export interface AppRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
  openEnterpriseRoot: string;
}

export function registerAppRoutes(
  options: AppRoutesOptions
) {
  const {
    app,
    repoRoot,
    openEnterpriseRoot
  } = options;

  const generatedAppsRoot =
    join(
      repoRoot,
      ".tmp",
      "generated-apps"
    );

  const tenancyStore = new TenancyStore(
    join(
      repoRoot,
      ".tmp",
      "tenancy",
      "tenancy.sqlite"
    )
  );

  let aiInitialized = false;

  async function initializeAI() {
    if (aiInitialized) {
      return;
    }

    permissionEngine.registerRule({
      id: "api-app-builder-ai",
      effect: "allow",
      actions: ["ai.generate"],
      subjects: ["agent:oeap.app-builder"],
      priority: 100
    });

    registerDeepSeekHarnessConnector({
      harnessRoot:
        join(
          openEnterpriseRoot,
          "deepseek-harness"
        ),
      dshHome:
        join(
          openEnterpriseRoot,
          ".dsh-dev"
        ),
      workspaceRoot:
        repoRoot
    });

    if (!packageManager.get(
      aiSkillPackage.manifest.id
    )) {
      await packageManager.install(
        aiSkillPackage
      );
    }

    if (!packageManager.isEnabled(
      aiSkillPackage.manifest.id
    )) {
      await packageManager.enable(
        aiSkillPackage.manifest.id
      );
    }

    aiInitialized = true;
  }

  async function loadApps() {
    try {
      const entries = await readdir(
        generatedAppsRoot,
        {
          withFileTypes: true
        }
      );

      const apps: any[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        try {
          const raw = await readFile(
            join(
              generatedAppsRoot,
              entry.name,
              "oeap.package.json"
            ),
            "utf8"
          );

          apps.push({
            ...JSON.parse(raw),
            status: "enabled",
            localDirectory: entry.name
          });
        } catch {
          // Ignore invalid generated application directories.
        }
      }

      return apps;
    } catch {
      return [];
    }
  }

  async function findApp(
    appId: string
  ) {
    const apps = await loadApps();

    return apps.find(
      (item) => item.id === appId
    );
  }

  function can(
    request: FastifyRequest,
    permission: string,
    appId?: string
  ): boolean {
    try {
      return tenancyStore.authorize({
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

  function forbidden(reply: any) {
    return reply
      .code(403)
      .send({
        ok: false,
        error: "Forbidden"
      });
  }

  function getDatabase(
    manifest: any,
    organizationId = "org_local"
  ) {
    const safeId =
      String(manifest.id).replace(
        /[^a-zA-Z0-9_.-]/g,
        "_"
      );

    const safeOrganizationId =
      String(organizationId).replace(
        /[^a-zA-Z0-9_.-]/g,
        "_"
      );

    const databaseFile =
      organizationId === "org_local"
        ? `${safeId}.sqlite`
        : `${safeOrganizationId}__${safeId}.sqlite`;

    const database =
      new AppDatabase(
        join(
          repoRoot,
          ".tmp",
          "databases",
          databaseFile
        )
      );

    database.ensureEntities(
      (
        manifest.metadata?.entities ??
        []
      ).map((entity: any) => ({
        name: entity.name,
        fields: entity.fields ?? []
      }))
    );

    return database;
  }

  async function withAppDatabase(
    request: FastifyRequest,
    appId: string,
    reply: any,
    permission: "data.read" | "data.write"
  ) {
    const manifest = await findApp(appId);

    if (!manifest) {
      reply
        .code(404)
        .send({
          ok: false,
          error: "App not found"
        });

      return undefined;
    }

    if (!can(request, permission, appId)) {
      forbidden(reply);
      return undefined;
    }

    return {
      manifest,
      organizationId:
        organizationFrom(request),
      memberId:
        memberFrom(request),
      database: getDatabase(
        manifest,
        organizationFrom(request)
      )
    };
  }

  async function loadBlueprint(
    manifest: any
  ): Promise<AppBlueprint> {
    const raw = await readFile(
      join(
        generatedAppsRoot,
        manifest.localDirectory,
        "app.blueprint.json"
      ),
      "utf8"
    );

    return JSON.parse(raw) as AppBlueprint;
  }

  function bumpPatchVersion(
    version: string
  ): string {
    const parts = version.split(".");
    const major =
      Number(parts[0] ?? 0) || 0;
    const minor =
      Number(parts[1] ?? 0) || 0;
    const patch =
      Number(parts[2] ?? 0) || 0;

    return `${major}.${minor}.${patch + 1}`;
  }

  app.get(
    "/api/apps",
    async (request) => {
      const apps = await loadApps();

      return {
        apps: apps.filter(
          (item) =>
            can(
              request,
              "apps.read",
              item.id
            )
        )
      };
    }
  );

  app.post<{
    Body: {
      description?: string;
      nameHint?: string;
    };
  }>(
    "/api/apps/generate",
    async (request, reply) => {
      if (!can(request, "apps.manage")) {
        return forbidden(reply);
      }

      const description =
        request.body?.description?.trim();

      if (!description) {
        return reply
          .code(400)
          .send({
            ok: false,
            error: "description is required"
          });
      }

      await initializeAI();

      const generated =
        await appBuilder.build({
          description,
          nameHint:
            request.body?.nameHint,
          language: "zh-CN"
        });

      const built =
        await appPackageBuilder.build({
          blueprint:
            generated.blueprint,
          packageId:
            `local.generated.${Date.now()}`,
          publisher: "local",
          version: "0.0.1",
          outputDir:
            generatedAppsRoot
        });

      return {
        ok: true,
        app: built.manifest,
        directory: built.directory
      };
    }
  );

  app.get<{
    Params: {
      appId: string;
    };
  }>(
    "/api/apps/:appId/blueprint",
    async (request, reply) => {
      if (
        !can(
          request,
          "apps.read",
          request.params.appId
        )
      ) {
        return forbidden(reply);
      }

      const manifest =
        await findApp(
          request.params.appId
        );

      if (!manifest) {
        return reply
          .code(404)
          .send({
            ok: false,
            error: "App not found"
          });
      }

      return {
        ok: true,
        blueprint:
          await loadBlueprint(manifest)
      };
    }
  );

  app.post<{
    Params: {
      appId: string;
    };
    Body: {
      instruction?: string;
    };
  }>(
    "/api/apps/:appId/revise",
    async (request, reply) => {
      if (
        !can(
          request,
          "apps.manage",
          request.params.appId
        )
      ) {
        return forbidden(reply);
      }

      const instruction =
        request.body?.instruction?.trim();

      if (!instruction) {
        return reply
          .code(400)
          .send({
            ok: false,
            error: "instruction is required"
          });
      }

      const manifest =
        await findApp(
          request.params.appId
        );

      if (!manifest) {
        return reply
          .code(404)
          .send({
            ok: false,
            error: "App not found"
          });
      }

      await initializeAI();

      const currentBlueprint =
        await loadBlueprint(manifest);

      const revised =
        await appBuilder.revise({
          blueprint:
            currentBlueprint,
          instruction,
          language: "zh-CN"
        });

      const nextVersion =
        bumpPatchVersion(
          String(
            manifest.version ??
            "0.0.1"
          )
        );

      const built =
        await appPackageBuilder.build({
          blueprint:
            revised.blueprint,
          packageId:
            manifest.id,
          publisher:
            manifest.publisher ??
            "local",
          version: nextVersion,
          outputDir:
            generatedAppsRoot,
          directoryName:
            manifest.localDirectory
        });

      const updatedApp = {
        ...built.manifest,
        status: "enabled",
        localDirectory:
          manifest.localDirectory
      };

      getDatabase(
        updatedApp,
        organizationFrom(request)
      );

      return {
        ok: true,
        app: updatedApp,
        previousVersion:
          manifest.version,
        version: nextVersion
      };
    }
  );

  app.get<{
    Params: {
      appId: string;
      entity: string;
    };
    Querystring: {
      q?: string;
      page?: string;
      pageSize?: string;
    };
  }>(
    "/api/apps/:appId/data/:entity",
    async (request, reply) => {
      const context =
        await withAppDatabase(
          request,
          request.params.appId,
          reply,
          "data.read"
        );

      if (!context) {
        return;
      }

      const page = Math.max(
        Number(
          request.query.page ?? 1
        ) || 1,
        1
      );

      const pageSize = Math.min(
        Math.max(
          Number(
            request.query.pageSize ??
            10
          ) || 10,
          1
        ),
        100
      );

      const query =
        request.query.q?.trim();

      return {
        ok: true,
        organizationId:
          context.organizationId,
        rows:
          context.database.list(
            request.params.entity,
            {
              query,
              limit: pageSize,
              offset:
                (page - 1) * pageSize
            }
          ),
        total:
          context.database.count(
            request.params.entity,
            query
          ),
        page,
        pageSize
      };
    }
  );

  app.get<{
    Params: {
      appId: string;
      entity: string;
      id: string;
    };
  }>(
    "/api/apps/:appId/data/:entity/:id",
    async (request, reply) => {
      const context =
        await withAppDatabase(
          request,
          request.params.appId,
          reply,
          "data.read"
        );

      if (!context) {
        return;
      }

      const row =
        context.database.get(
          request.params.entity,
          Number(request.params.id)
        );

      if (!row) {
        return reply
          .code(404)
          .send({
            ok: false,
            error: "Row not found"
          });
      }

      return {
        ok: true,
        organizationId:
          context.organizationId,
        row
      };
    }
  );

  app.post<{
    Params: {
      appId: string;
      entity: string;
    };
    Body: Record<string, unknown>;
  }>(
    "/api/apps/:appId/data/:entity",
    async (request, reply) => {
      const context =
        await withAppDatabase(
          request,
          request.params.appId,
          reply,
          "data.write"
        );

      if (!context) {
        return;
      }

      return {
        ok: true,
        organizationId:
          context.organizationId,
        row:
          context.database.create(
            request.params.entity,
            request.body ?? {}
          )
      };
    }
  );

  app.put<{
    Params: {
      appId: string;
      entity: string;
      id: string;
    };
    Body: Record<string, unknown>;
  }>(
    "/api/apps/:appId/data/:entity/:id",
    async (request, reply) => {
      const context =
        await withAppDatabase(
          request,
          request.params.appId,
          reply,
          "data.write"
        );

      if (!context) {
        return;
      }

      const row =
        context.database.update(
          request.params.entity,
          Number(request.params.id),
          request.body ?? {}
        );

      if (!row) {
        return reply
          .code(404)
          .send({
            ok: false,
            error: "Row not found"
          });
      }

      return {
        ok: true,
        organizationId:
          context.organizationId,
        row
      };
    }
  );

  app.delete<{
    Params: {
      appId: string;
      entity: string;
      id: string;
    };
  }>(
    "/api/apps/:appId/data/:entity/:id",
    async (request, reply) => {
      const context =
        await withAppDatabase(
          request,
          request.params.appId,
          reply,
          "data.write"
        );

      if (!context) {
        return;
      }

      const deleted =
        context.database.delete(
          request.params.entity,
          Number(request.params.id)
        );

      if (!deleted) {
        return reply
          .code(404)
          .send({
            ok: false,
            error: "Row not found"
          });
      }

      return {
        ok: true,
        organizationId:
          context.organizationId
      };
    }
  );

  return {
    loadApps
  };
}
