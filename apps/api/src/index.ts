import Fastify from "fastify";
import cors from "@fastify/cors";

import {
  dirname,
  resolve
} from "node:path";

import {
  fileURLToPath
} from "node:url";

import {
  registerAppRoutes
} from "./appRoutes.js";

import {
  registerPlatformRoutes
} from "./platformRoutes.js";

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

app.get("/health", async () => ({
  ok: true,
  service: "oeap-api"
}));

const appRoutes =
  registerAppRoutes({
    app,
    repoRoot,
    openEnterpriseRoot
  });

registerPlatformRoutes({
  app,
  repoRoot,
  loadApps:
    appRoutes.loadApps
});

await app.listen({
  port: 8787,
  host: "127.0.0.1"
});
