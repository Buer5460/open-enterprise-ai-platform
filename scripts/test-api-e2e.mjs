import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 19000 + Math.floor(Math.random() * 5000);
const dataDir = await mkdtemp(join(tmpdir(), "oeap-api-e2e-"));
const base = `http://127.0.0.1:${port}`;

const child = spawn(
  process.execPath,
  ["apps/api/dist/index.js"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OEAP_API_PORT: String(port),
      OEAP_API_HOST: "127.0.0.1",
      OEAP_DEPLOYMENT_MODE: "development",
      OEAP_LOCAL_AUTH: "enabled",
      OEAP_DATA_DIR: dataDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  }
);

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForHealth();

  const health = await jsonRequest("/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.service, "oeap-api");
  assert.equal(health.body.version, "0.9.0");

  const ready = await jsonRequest("/ready");
  assert.equal(ready.response.status, 200);
  assert.equal(ready.body.ready, true);
  assert.equal(
    ready.body.checks.some(
      (check) => check.id === "data-directory" && check.status === "pass"
    ),
    true
  );

  const providers = await jsonRequest("/api/auth/providers");
  assert.equal(providers.response.status, 200);
  assert.equal(providers.body.deploymentMode, "development");
  assert.equal(providers.body.localDevelopmentMode, true);

  const login = await jsonRequest("/api/auth/local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.ok, true);
  assert.equal(typeof login.body.token, "string");
  assert.ok(login.body.token.length > 20);

  const authorization = {
    Authorization: `Bearer ${login.body.token}`
  };

  const session = await jsonRequest("/api/auth/session", {
    headers: authorization
  });
  assert.equal(session.response.status, 200);
  assert.equal(session.body.authenticated, true);
  assert.equal(session.body.member.id, "member_local_owner");

  const packages = await jsonRequest("/api/platform/packages", {
    headers: authorization
  });
  assert.equal(packages.response.status, 200);
  assert.equal(packages.body.ok, true);
  assert.ok(Array.isArray(packages.body.packages));

  console.log("✅ BUILT API E2E TEST PASSED");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ]);
  if (!child.killed) child.kill("SIGKILL");
  await rm(dataDir, { recursive: true, force: true });
}

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `OEAP API exited before readiness (code ${child.exitCode})\n${output}`
      );
    }
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for OEAP API\n${output}`);
}

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
