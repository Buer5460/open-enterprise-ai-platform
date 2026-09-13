#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const args = process.argv.slice(2);
const live = args.includes("--live");
const envFileIndex = args.indexOf("--env-file");
const envFile =
  envFileIndex >= 0
    ? args[envFileIndex + 1]
    : undefined;

const environment = {
  ...process.env,
  ...(envFile ? await readEnvFile(envFile) : {})
};

const checks = [];

function add(id, status, message, action) {
  checks.push({ id, status, message, action });
}

const production = value("OEAP_DEPLOYMENT_MODE") === "production";
add(
  "deployment-mode",
  production ? "pass" : "fail",
  production
    ? "OEAP_DEPLOYMENT_MODE=production"
    : "OEAP_DEPLOYMENT_MODE is not production",
  production ? undefined : "Set OEAP_DEPLOYMENT_MODE=production"
);

const localAuth = value("OEAP_LOCAL_AUTH").toLowerCase();
add(
  "local-auth",
  localAuth === "enabled" ? "fail" : "pass",
  localAuth === "enabled"
    ? "Unsafe OEAP_LOCAL_AUTH=enabled is configured"
    : "Local Development login is not configured as enabled",
  localAuth === "enabled"
    ? "Remove OEAP_LOCAL_AUTH=enabled or set it to disabled"
    : undefined
);

const providerNames = [];
if (has("OEAP_GITHUB_CLIENT_ID") && has("OEAP_GITHUB_CLIENT_SECRET")) {
  providerNames.push("GitHub");
}
if (has("OEAP_GOOGLE_CLIENT_ID") && has("OEAP_GOOGLE_CLIENT_SECRET")) {
  providerNames.push("Google Workspace");
}
if (has("OEAP_MICROSOFT_CLIENT_ID") && has("OEAP_MICROSOFT_CLIENT_SECRET")) {
  providerNames.push("Microsoft Entra ID");
}
if (
  has("OEAP_OIDC_ISSUER") &&
  has("OEAP_OIDC_CLIENT_ID") &&
  has("OEAP_OIDC_CLIENT_SECRET")
) {
  providerNames.push("Enterprise OIDC");
}
add(
  "identity-provider",
  providerNames.length > 0 ? "pass" : "fail",
  providerNames.length > 0
    ? `Configured identity provider(s): ${providerNames.join(", ")}`
    : "No complete OAuth/OIDC provider configuration found",
  providerNames.length > 0
    ? undefined
    : "Configure at least one organization-owned OAuth/OIDC provider"
);

const webUrl = validHttpsUrl(value("OEAP_PUBLIC_WEB_URL"));
const apiUrl = validHttpsUrl(value("OEAP_PUBLIC_API_URL"));
add(
  "public-web-url",
  webUrl ? "pass" : "fail",
  webUrl
    ? `Public Web origin: ${webUrl.origin}`
    : "OEAP_PUBLIC_WEB_URL must be a valid HTTPS URL",
  webUrl ? undefined : "Set OEAP_PUBLIC_WEB_URL=https://..."
);
add(
  "public-api-url",
  apiUrl ? "pass" : "fail",
  apiUrl
    ? `Public API origin: ${apiUrl.origin}`
    : "OEAP_PUBLIC_API_URL must be a valid HTTPS URL",
  apiUrl ? undefined : "Set OEAP_PUBLIC_API_URL=https://..."
);

const origins = value("OEAP_CORS_ORIGINS")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (origins.includes("*")) {
  add(
    "cors",
    "fail",
    "Production CORS must not contain wildcard origin *",
    "Use exact HTTPS Web origins"
  );
} else if (webUrl && apiUrl && webUrl.origin !== apiUrl.origin) {
  const parsed = origins.map((item) => validHttpsOrigin(item));
  const allValid = parsed.every(Boolean);
  const includesWeb = parsed.some((item) => item?.origin === webUrl.origin);
  add(
    "cors",
    allValid && includesWeb ? "pass" : "fail",
    allValid && includesWeb
      ? `Cross-origin API allows Web origin ${webUrl.origin}`
      : "Cross-origin deployment requires explicit HTTPS CORS origin including OEAP_PUBLIC_WEB_URL",
    allValid && includesWeb
      ? undefined
      : `Set OEAP_CORS_ORIGINS=${webUrl.origin}`
  );
} else {
  const allValid = origins.every((item) => Boolean(validHttpsOrigin(item)));
  add(
    "cors",
    allValid ? "pass" : "fail",
    origins.length === 0
      ? "Same-origin deployment can keep CORS disabled"
      : "Configured CORS origins are explicit HTTPS origins",
    allValid ? undefined : "Replace invalid/non-HTTPS CORS origins"
  );
}

const ttl = Number(value("OEAP_SESSION_TTL_HOURS") || "8");
const ttlValid = Number.isFinite(ttl) && ttl >= 1 && ttl <= 24 * 30;
add(
  "session-ttl",
  ttlValid ? "pass" : "fail",
  ttlValid
    ? `Session TTL: ${ttl} hour(s)`
    : "OEAP_SESSION_TTL_HOURS must be between 1 and 720 hours",
  ttlValid ? undefined : "Set a bounded Session TTL, normally 8 hours"
);

const dataDirRaw = value("OEAP_DATA_DIR");
let dataDir;
if (dataDirRaw) {
  dataDir = isAbsolute(dataDirRaw)
    ? dataDirRaw
    : resolve(process.cwd(), dataDirRaw);
}

if (!dataDir || dataDir === "/") {
  add(
    "data-dir",
    "fail",
    !dataDir
      ? "OEAP_DATA_DIR is not configured"
      : "OEAP_DATA_DIR must not be the filesystem root",
    "Set OEAP_DATA_DIR to a dedicated persistent volume path"
  );
} else {
  let writable = true;
  try {
    await access(dataDir, constants.R_OK | constants.W_OK);
  } catch {
    writable = false;
  }
  add(
    "data-dir",
    writable ? "pass" : "warning",
    writable
      ? `Persistent data directory is readable/writable: ${dataDir}`
      : `Persistent data directory is configured but not currently readable/writable: ${dataDir}`,
    writable
      ? undefined
      : "Create/mount the directory with the runtime user before starting OEAP"
  );
}

const mailConfigured = Boolean(
  value("OEAP_MAIL_PROVIDER") ||
  value("OEAP_SMTP_HOST") ||
  value("RESEND_API_KEY") ||
  value("OEAP_MAIL_WEBHOOK_URL")
);
add(
  "mail",
  mailConfigured ? "pass" : "warning",
  mailConfigured
    ? "A deployment-level mail configuration is present (organization UI configuration may also be used)"
    : "No deployment-level automatic mail configuration detected; manual invitation links remain available"
);

const aiConfigured = Boolean(
  value("OEAP_HARNESS_ROOT") ||
  value("OEAP_HARNESS_HOST_PATH")
);
add(
  "ai-runtime",
  aiConfigured ? "pass" : "warning",
  aiConfigured
    ? "An AI runtime path is configured"
    : "No AI runtime path detected; core OEAP can run, but AI generation/revision requires a provider runtime"
);

if (live) {
  if (webUrl) {
    await liveWebCheck(webUrl);
  }
  if (apiUrl) {
    await liveApiCheck(apiUrl);
  }
}

const failures = checks.filter((item) => item.status === "fail");
const warnings = checks.filter((item) => item.status === "warning");

console.log("OEAP Production Preflight");
console.log("=========================");
for (const check of checks) {
  const mark =
    check.status === "pass"
      ? "✅"
      : check.status === "warning"
        ? "⚠️"
        : "❌";
  console.log(`${mark} [${check.id}] ${check.message}`);
  if (check.action) {
    console.log(`   → ${check.action}`);
  }
}
console.log("");
console.log(`Result: ${failures.length} failure(s), ${warnings.length} warning(s)`);

if (failures.length > 0) {
  process.exitCode = 1;
} else {
  console.log("✅ Production preflight passed");
}

function value(name) {
  return String(environment[name] || "").trim();
}

function has(name) {
  return value(name).length > 0;
}

function validHttpsUrl(input) {
  if (!input) return undefined;
  try {
    const url = new URL(input);
    return url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function validHttpsOrigin(input) {
  const url = validHttpsUrl(input);
  if (!url) return undefined;
  if (url.pathname !== "/" || url.search || url.hash) {
    return undefined;
  }
  return url;
}

async function liveWebCheck(url) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000)
    });
    add(
      "live-web",
      response.ok ? "pass" : "fail",
      `Web returned HTTP ${response.status}`,
      response.ok ? undefined : "Fix the public Web/reverse-proxy deployment"
    );

    const requiredHeaders = [
      "content-security-policy",
      "x-content-type-options",
      "referrer-policy"
    ];
    const missing = requiredHeaders.filter(
      (name) => !response.headers.get(name)
    );
    add(
      "live-web-headers",
      missing.length === 0 ? "pass" : "warning",
      missing.length === 0
        ? "Web security headers are present"
        : `Missing recommended Web security header(s): ${missing.join(", ")}`,
      missing.length === 0
        ? undefined
        : "Verify requests are passing through the supplied/trusted reverse proxy"
    );
  } catch (error) {
    add(
      "live-web",
      "fail",
      `Cannot reach public Web URL: ${errorMessage(error)}`,
      "Check DNS, TLS and reverse proxy"
    );
  }
}

async function liveApiCheck(url) {
  for (const path of ["/health", "/ready"]) {
    try {
      const response = await fetch(
        new URL(path, `${url.origin}/`),
        {
          redirect: "follow",
          signal: AbortSignal.timeout(15_000)
        }
      );
      const body = await response.json().catch(() => ({}));
      const healthy = response.ok && body?.ok === true;
      add(
        `live-api-${path.slice(1)}`,
        healthy ? "pass" : "fail",
        `${path} returned HTTP ${response.status}${body?.version ? ` (OEAP ${body.version})` : ""}`,
        healthy
          ? undefined
          : `Resolve ${path} failures before routing user traffic`
      );
    } catch (error) {
      add(
        `live-api-${path.slice(1)}`,
        "fail",
        `Cannot reach ${path}: ${errorMessage(error)}`,
        "Check API DNS, TLS and reverse proxy"
      );
    }
  }
}

async function readEnvFile(path) {
  const text = await readFile(path, "utf8");
  const parsed = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let val = line.slice(separator + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    parsed[key] = val;
  }

  return parsed;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
