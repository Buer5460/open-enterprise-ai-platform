import Fastify from "fastify";
import cors from "@fastify/cors";
import { DataValidationError } from "@oeap/data-runtime";

import {
  dirname,
  resolve
} from "node:path";

import {
  fileURLToPath
} from "node:url";

import {
  registerActionHubAuthorizationHook
} from "./actionHubAuthorization.js";
import {
  registerActionHubRoutes
} from "./actionHubRoutes.js";
import {
  registerAgentKnowledgeBridge
} from "./agentKnowledgeBridge.js";
import {
  registerAIRuntimeRoutes
} from "./aiRuntimeRoutes.js";
import {
  registerAuthRoutes
} from "./authRoutes.js";
import {
  registerAppHistoryRoutes
} from "./appHistoryRoutes.js";
import {
  registerAppLifecycleRoutes
} from "./appLifecycleRoutes.js";
import {
  registerAppPreferenceRoutes
} from "./appPreferenceRoutes.js";
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
  registerDataExchangeRoutes
} from "./dataExchangeRoutes.js";
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
import {
  registerUsabilityRoutes
} from "./usabilityRoutes.js";

const app = Fastify({
  logger: true,
  trustProxy:
    process.env.OEAP_TRUST_PROXY === "true",
  bodyLimit: requestBodyLimit()
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof DataValidationError) {
    return reply.code(422).send({
      ok: false,
      code: error.code,
      field: error.field,
      error: error.message
    });
  }

  const candidate = error as {
    statusCode?: unknown;
    message?: unknown;
  };
  const statusCode =
    typeof candidate.statusCode === "number"
      ? candidate.statusCode
      : 500;
  const message =
    typeof candidate.message === "string" &&
    candidate.message.trim()
      ? candidate.message
      : "Request failed";

  if (statusCode >= 500) {
    request.log.error(error);
  }

  return reply.code(statusCode).send({
    ok: false,
    statusCode,
    error:
      statusCode >= 500 && deploymentMode() === "production"
        ? "Internal Server Error"
        : message
  });
});

await app.register(cors, {
  origin: corsOriginPolicy()
});

app.addHook("preValidation", async (request, reply) => {
  const raw = request.raw.url ?? request.url;
  let parsed: URL;

  try {
    parsed = new URL(raw, "http://oeap.local");
  } catch {
    return;
  }

  if (
    parsed.pathname === "/api/tenancy/authorize" &&
    (
      parsed.searchParams.has("memberId") ||
      parsed.searchParams.has("organizationId")
    )
  ) {
    return reply.code(400).send({
      ok: false,
      error:
        "Permission checks are limited to the current authenticated organization/member"
    });
  }
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

registerAIRuntimeRoutes({
  app,
  repoRoot,
  openEnterpriseRoot
});

registerActionHubAuthorizationHook({
  app,
  repoRoot
});

registerActionHubRoutes({
  app,
  repoRoot,
  openEnterpriseRoot
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

registerAppPreferenceRoutes({
  app,
  repoRoot,
  loadApps:
    appRoutes.loadApps
});

registerUsabilityRoutes({
  app,
  repoRoot,
  openEnterpriseRoot,
  loadApps:
    appRoutes.loadApps
});

registerDataExchangeRoutes({
  app,
  repoRoot,
  loadApps:
    appRoutes.loadApps
});

registerAppLifecycleRoutes({
  app,
  repoRoot,
  loadApps:
    appRoutes.loadApps
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

  if (deploymentMode() === "production") {
    for (const origin of configured) {
      if (origin === "*") {
        throw new Error(
          "OEAP_CORS_ORIGINS must not contain '*' in production"
        );
      }

      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        throw new Error(
          `Invalid production CORS origin: ${origin}`
        );
      }

      if (url.protocol !== "https:") {
        throw new Error(
          `Production CORS origins must use HTTPS: ${origin}`
        );
      }

      if (url.pathname !== "/" || url.search || url.hash) {
        throw new Error(
          `CORS origins must be origin-only URLs without path/query/hash: ${origin}`
        );
      }
    }
  }

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
