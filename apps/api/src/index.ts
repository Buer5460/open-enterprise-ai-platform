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
  registerAuthRoutes
} from "./authRoutes.js";

import {
  registerAppRoutes
} from "./appRoutes.js";

import {
  registerBrandSettingsRoutes
} from "./brandSettingsRoutes.js";

import {
  registerDeploymentRoutes
} from "./deploymentRoutes.js";

import {
  registerInvitationRoutes
} from "./invitationRoutes.js";

import {
  registerInvitationDeliveryRoutes
} from "./invitationDeliveryRoutes.js";

import {
  registerMailSettingsRoutes
} from "./mailSettingsRoutes.js";

import {
  registerPlatformRoutes
} from "./platformRoutes.js";

import {
  registerTenancyRoutes
} from "./tenancyRoutes.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: corsOriginPolicy()
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

registerAuthRoutes({
  app,
  repoRoot
});

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

registerTenancyRoutes({
  app,
  repoRoot
});

const brandSettingsStore =
  registerBrandSettingsRoutes({
    app,
    repoRoot
  });

const mailSettingsStore =
  registerMailSettingsRoutes({
    app,
    repoRoot
  });

registerDeploymentRoutes({
  app,
  repoRoot,
  mailSettingsStore,
  brandSettingsStore
});

registerInvitationRoutes({
  app,
  repoRoot,
  loadApps:
    appRoutes.loadApps
});

registerInvitationDeliveryRoutes({
  app,
  repoRoot,
  mailSettingsStore,
  brandSettingsStore
});

await app.listen({
  port: 8787,
  host: "127.0.0.1"
});

function corsOriginPolicy():
  | true
  | false
  | string
  | string[] {
  const configured =
    process.env.OEAP_CORS_ORIGINS
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];

  if (configured.length === 1) {
    return configured[0];
  }

  if (configured.length > 1) {
    return configured;
  }

  const production =
    process.env.OEAP_DEPLOYMENT_MODE
      ?.trim()
      .toLowerCase() === "production";

  return production ? false : true;
}
