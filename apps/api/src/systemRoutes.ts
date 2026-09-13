import type { FastifyInstance } from "fastify";
import {
  access,
  mkdir,
  rm,
  writeFile
} from "node:fs/promises";
import {
  constants,
  readFileSync
} from "node:fs";
import { join } from "node:path";

import {
  createOfficialMarketplaceRegistry
} from "@oeap/marketplace-registry";

import {
  registerMarketplaceRoutes
} from "./marketplaceRoutes.js";
import { runtimeDataRoot } from "./runtimePaths.js";

export function registerSystemRoutes(input: {
  app: FastifyInstance;
  repoRoot: string;
}) {
  const version = platformVersion(input.repoRoot);

  registerMarketplaceRoutes({
    app: input.app,
    registry: createOfficialMarketplaceRegistry()
  });

  input.app.get("/health", async () => ({
    ok: true,
    service: "oeap-api",
    version,
    mode: deploymentMode(),
    time: new Date().toISOString()
  }));

  input.app.get("/ready", async (_request, reply) => {
    const checks = await Promise.all([
      dataDirectoryCheck(input.repoRoot),
      Promise.resolve(authConfigurationCheck()),
      Promise.resolve(publicUrlCheck())
    ]);

    const ready = checks.every(
      (check) => check.status !== "fail"
    );

    const payload = {
      ok: ready,
      ready,
      service: "oeap-api",
      version,
      mode: deploymentMode(),
      checks,
      time: new Date().toISOString()
    };

    return ready
      ? payload
      : reply.code(503).send(payload);
  });
}

export function platformVersion(
  repoRoot: string
): string {
  try {
    const pkg = JSON.parse(
      readFileSync(
        join(repoRoot, "package.json"),
        "utf8"
      )
    ) as { version?: unknown };

    return typeof pkg.version === "string" &&
      pkg.version.trim()
      ? pkg.version.trim()
      : "unknown";
  } catch {
    return "unknown";
  }
}

type ReadyCheck = {
  id: string;
  status: "pass" | "warning" | "fail";
  message: string;
};

async function dataDirectoryCheck(
  repoRoot: string
): Promise<ReadyCheck> {
  const root = runtimeDataRoot(repoRoot);
  const probe = join(
    root,
    `.oeap-ready-${process.pid}-${Date.now()}`
  );

  try {
    await mkdir(root, { recursive: true });
    await access(root, constants.R_OK | constants.W_OK);
    await writeFile(probe, "ok", "utf8");
    await rm(probe, { force: true });
    return {
      id: "data-directory",
      status: "pass",
      message: "Runtime data directory is readable and writable"
    };
  } catch (error) {
    await rm(probe, { force: true }).catch(() => undefined);
    return {
      id: "data-directory",
      status: "fail",
      message:
        error instanceof Error
          ? error.message
          : "Runtime data directory is not writable"
    };
  }
}

function authConfigurationCheck(): ReadyCheck {
  if (deploymentMode() !== "production") {
    return {
      id: "authentication",
      status: "pass",
      message: "Development authentication mode"
    };
  }

  const localAuth = process.env.OEAP_LOCAL_AUTH
    ?.trim()
    .toLowerCase();

  if (localAuth === "enabled") {
    return {
      id: "authentication",
      status: "fail",
      message: "Production must not explicitly enable Local Development login"
    };
  }

  const externalConfigured = Boolean(
    (
      process.env.OEAP_GITHUB_CLIENT_ID &&
      process.env.OEAP_GITHUB_CLIENT_SECRET
    ) ||
    (
      process.env.OEAP_GOOGLE_CLIENT_ID &&
      process.env.OEAP_GOOGLE_CLIENT_SECRET
    ) ||
    (
      process.env.OEAP_MICROSOFT_CLIENT_ID &&
      process.env.OEAP_MICROSOFT_CLIENT_SECRET
    ) ||
    (
      process.env.OEAP_OIDC_ISSUER &&
      process.env.OEAP_OIDC_CLIENT_ID &&
      process.env.OEAP_OIDC_CLIENT_SECRET
    )
  );

  return externalConfigured
    ? {
        id: "authentication",
        status: "pass",
        message: "At least one production identity provider is configured"
      }
    : {
        id: "authentication",
        status: "fail",
        message: "Production requires at least one external OAuth/OIDC provider"
      };
}

function publicUrlCheck(): ReadyCheck {
  if (deploymentMode() !== "production") {
    return {
      id: "public-urls",
      status: "pass",
      message: "Public URLs are optional in development"
    };
  }

  const web = process.env.OEAP_PUBLIC_WEB_URL?.trim();
  const api = process.env.OEAP_PUBLIC_API_URL?.trim();

  if (!web || !api) {
    return {
      id: "public-urls",
      status: "fail",
      message: "Production requires OEAP_PUBLIC_WEB_URL and OEAP_PUBLIC_API_URL"
    };
  }

  if (!securePublicUrl(web) || !securePublicUrl(api)) {
    return {
      id: "public-urls",
      status: "fail",
      message: "Production public URLs must use HTTPS"
    };
  }

  return {
    id: "public-urls",
    status: "pass",
    message: "Production public URLs are configured with HTTPS"
  };
}

function securePublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
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
