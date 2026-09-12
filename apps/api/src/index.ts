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

app.get("/health", async () => {
  return {
    ok: true,
    service: "oeap-api"
  };
});

app.get("/api/apps", async () => {
  try {
    const entries =
      await readdir(
        generatedAppsRoot,
        {
          withFileTypes: true
        }
      );

    const apps = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifestPath =
        join(
          generatedAppsRoot,
          entry.name,
          "oeap.package.json"
        );

      try {
        const raw =
          await readFile(
            manifestPath,
            "utf8"
          );

        const manifest =
          JSON.parse(raw);

        apps.push({
          ...manifest,
          status: "enabled",
          localDirectory: entry.name
        });
      } catch {
        // Ignore invalid app folders.
      }
    }

    return {
      apps
    };
  } catch {
    return {
      apps: []
    };
  }
});

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

    const packageId =
      `local.generated.${Date.now()}`;

    const built =
      await appPackageBuilder.build({
        blueprint:
          generated.blueprint,

        packageId,

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

await app.listen({
  port: 8787,
  host: "127.0.0.1"
});
