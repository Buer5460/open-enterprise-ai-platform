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
  registerAgentKnowledgeBridge
} from "./agentKnowledgeBridge.js";
import {
  registerAuthRoutes
} from "./authRoutes.js";
import {
  registerAppHistoryRoutes
} from "./appHistoryRoutes.js";
import {
  registerAppRoutes
} from "./appRoutes.js";
import {
  registerBrandSettingsRoutes
} from "./brandSettingsRoutes.js";
import {
  registerConnectorSecretRoutes
} from "./connectorSecretRoutes.js";
import {
  registerDeploymentRoutes
} from "./deploymentRoutes.js";
import {
  registerFileRoutes
} from "./fileRoutes.js";
import {
  registerGitHubPublisherRoutes
} from "./githubPublisherRoutes.js";
import {
  registerInvitationRoutes
} from "./invitationRoutes.js";
import {
  registerInvitationDeliveryRoutes
} from "./invitationDeliveryRoutes.js";
import {
  registerKnowledgeRoutes
} from "./knowledgeRoutes.js";
import {
  registerMailSettingsRoutes
} from "./mailSettingsRoutes.js";
import {
  registerOperationsRoutes
} from "./operationsRoutes.js";
import {
  registerPackageProvenanceRoutes
} from "./packageProvenanceRoutes.js";
import {
  registerPlatformRoutes
} from "./platformRoutes.js";
import {
  registerRemotePackageRoutes
} from "./remotePackageRoutes.js";
import {
  registerSystemRoutes
} from "./systemRoutes.js";
import {
  registerTenancyRoutes
} from "./tenancyRoutes.js";

const app = Fastify({
  logger: true,
  trustProxy:
    process.env.OEAP_TRUST_PROXY === "true",
  bodyLimit: requestBodyLimit()
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

registerAgentKnowledgeBridge({
  repoRoot
});

registerSystemRoutes({
  app,
  repoRoot
});

registerAuthRoutes({
  app,
  repoRoot
});

registerOperationsRoutes({
  app,
  repoRoot
});

const appRoutes = registerAppRoutes({
  app,
  repoRoot,
  openEnterpriseRoot
});

registerAppHistoryRoutes({
  app,
  repoRoot
});

registerFileRoutes({
  app,
  repoRoot
});

registerKnowledgeRoutes({
  app,
  repoRoot
});

registerConnectorSecretRoutes({
  app,
  repoRoot
});

registerGitHubPublisherRoutes({
  app,
  repoRoot
});

registerPackageProvenanceRoutes({
  app,
  repoRoot
});

registerRemotePackageRoutes({
  app,
  repoRoot
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

const brandSettingsStore = registerBrandSettingsRoutes({
  app,
  repoRoot
});

const mailSettingsStore = registerMailSettingsRoutes({
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

const port = integerEnvironment(
  "OEAP_API_PORT",
  8787
);
const host =
  process.env.OEAP_API_HOST?.trim() ||
  (deploymentMode() === "production"
    ? "0.0.0.0"
    : "127.0.0.1");

await app.listen({
  port,
  host
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

  return deploymentMode() === "production"
    ? false
    : true;
}

function deploymentMode():
  | "development"
  | "production" {
  return process.env.OEAP_DEPLOYMENT_MODE
    ?.trim()
    .toLowerCase() === "production"
    ? "production"
    : "development";
}

function integerEnvironment(
  name: string,
  fallback: number
): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) &&
    value > 0 &&
    value <= 65535
    ? value
    : fallback;
}

function requestBodyLimit(): number {
  const requestedMb = Number(
    process.env.OEAP_MAX_FILE_MB || 10
  );
  const fileMb =
    Number.isFinite(requestedMb) && requestedMb > 0
      ? Math.min(requestedMb, 25)
      : 10;

  return Math.ceil(
    (fileMb * 4 / 3 + 1) * 1024 * 1024
  );
}
