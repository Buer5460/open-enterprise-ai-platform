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

const generatedAppsRoot =
  join(
    repoRoot,
    ".tmp",
    "generated-apps"
  );

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
        // Ignore invalid folders.
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

await app.listen({
  port: 8787,
  host: "127.0.0.1"
});
