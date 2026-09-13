import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 24000 + Math.floor(Math.random() * 3000);
const dataDir = await mkdtemp(
  join(tmpdir(), "oeap-app-lifecycle-")
);
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

let logs = "";
child.stdout.on("data", (chunk) => {
  logs += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  logs += chunk.toString();
});

try {
  await waitForHealth();

  const login = await json("/api/auth/local", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  assert.equal(login.response.status, 200);
  const headers = {
    Authorization: `Bearer ${login.body.token}`
  };

  const installed = await json(
    "/api/usability/templates/crm-basic/install",
    {
      method: "POST",
      headers
    }
  );
  assert.equal(installed.response.status, 200);
  assert.equal(installed.body.ok, true);
  const appId = installed.body.app.id;

  const created = await json(
    `/api/apps/${encodeURIComponent(appId)}/data/Customer`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Lifecycle Customer",
        status: "已成交"
      })
    }
  );
  assert.equal(created.response.status, 200);
  assert.equal(created.body.row.name, "Lifecycle Customer");

  const archive = await json(
    `/api/apps/${encodeURIComponent(appId)}/archive`,
    {
      method: "POST",
      headers
    }
  );
  assert.equal(archive.response.status, 200);
  assert.equal(archive.body.ok, true);

  const afterArchive = await json("/api/apps", { headers });
  assert.equal(afterArchive.response.status, 200);
  assert.equal(
    afterArchive.body.apps.some((item) => item.id === appId),
    false
  );

  const archived = await json("/api/apps-archive", { headers });
  assert.equal(archived.response.status, 200);
  assert.equal(archived.body.ok, true);
  assert.equal(archived.body.apps.length, 1);
  assert.equal(archived.body.apps[0].id, appId);
  assert.equal(typeof archived.body.apps[0].archivedAt, "string");

  const restore = await json(
    `/api/apps-archive/${encodeURIComponent(appId)}/restore`,
    {
      method: "POST",
      headers
    }
  );
  assert.equal(restore.response.status, 200);
  assert.equal(restore.body.ok, true);
  assert.equal(restore.body.app.id, appId);

  const afterRestore = await json("/api/apps", { headers });
  assert.equal(afterRestore.response.status, 200);
  assert.equal(
    afterRestore.body.apps.some((item) => item.id === appId),
    true
  );

  const archivedAfterRestore = await json(
    "/api/apps-archive",
    { headers }
  );
  assert.equal(archivedAfterRestore.response.status, 200);
  assert.equal(archivedAfterRestore.body.apps.length, 0);

  const preserved = await json(
    `/api/apps/${encodeURIComponent(appId)}/data/Customer?page=1&pageSize=10`,
    { headers }
  );
  assert.equal(preserved.response.status, 200);
  assert.equal(preserved.body.total, 1);
  assert.equal(
    preserved.body.rows[0].name,
    "Lifecycle Customer"
  );

  console.log(
    "✅ APP ARCHIVE / RESTORE PRESERVES BUSINESS DATA"
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(dataDir, { recursive: true, force: true });
}

async function waitForHealth() {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `OEAP API exited before lifecycle test\n${logs}`
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

  throw new Error(`Timed out waiting for OEAP API\n${logs}`);
}

async function json(path, init = {}) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
