import Fastify from "fastify";
import cors from "@fastify/cors";

import {
  readdir,
  readFile
} from "node:fs/promises";

import {
  resolve,
  dirname,
  join
} from "node:path";

import {
  fileURLToPath
} from "node:url";

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
  appBuilder
} from "@oeap/app-builder";

import {
  appPackageBuilder
} from "@oeap/app-package-builder";

import {
  AppDatabase
} from "@oeap/data-runtime";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

const currentDir =
  dirname(fileURLToPath(import.meta.url));

const repoRoot =
  resolve(currentDir, "../../..");

const openEnterpriseRoot =
  resolve(repoRoot, "..");

const generatedAppsRoot =
  join(
    repoRoot,
    ".tmp",
    "generated-apps"
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

  await packageManager.install(
    aiSkillPackage
  );

  await packageManager.enable(
    aiSkillPackage.manifest.id
  );

  aiInitialized = true;
}

async function loadApps() {
  try {
    const entries =
      await readdir(
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
        const raw =
          await readFile(
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
        // Ignore invalid app folders.
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
  const apps =
    await loadApps();

  return apps.find(
    (item) => item.id === appId
  );
}

function getDatabase(
  manifest: any
) {
  const safeId =
    String(manifest.id).replace(
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
  appId: string,
  reply: any
) {
  const manifest =
    await findApp(appId);

  if (!manifest) {
    reply
      .code(404)
      .send({
        ok: false,
        error: "App not found"
      });

    return undefined;
  }

  return {
    manifest,
    database: getDatabase(manifest)
  };
}

app.get("/health", async () => {
  return {
    ok: true,
    service: "oeap-api"
  };
});

app.get(
  "/api/apps",
  async () => {
    return {
      apps: await loadApps()
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

        publisher:
          "local",

        version:
          "0.0.1",

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
        request.params.appId,
        reply
      );

    if (!context) {
      return;
    }

    const page = Math.max(
      Number(request.query.page ?? 1) || 1,
      1
    );

    const pageSize = Math.min(
      Math.max(
        Number(request.query.pageSize ?? 10) || 10,
        1
      ),
      100
    );

    const query =
      request.query.q?.trim();

    return {
      ok: true,
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
        request.params.appId,
        reply
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
        request.params.appId,
        reply
      );

    if (!context) {
      return;
    }

    return {
      ok: true,
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
        request.params.appId,
        reply
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
        request.params.appId,
        reply
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
      ok: true
    };
  }
);

await app.listen({
  port: 8787,
  host: "127.0.0.1"
});
