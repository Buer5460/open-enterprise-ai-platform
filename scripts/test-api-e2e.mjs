import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 19000 + Math.floor(Math.random() * 5000);
const dataDir = await mkdtemp(join(tmpdir(), "oeap-api-e2e-"));
const base = `http://127.0.0.1:${port}`;
const platformPackage = JSON.parse(
  await readFile(join(process.cwd(), "package.json"), "utf8")
);
const expectedVersion = String(platformPackage.version || "");
assert.ok(expectedVersion, "root package.json must declare platform version");

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
  assert.equal(health.body.version, expectedVersion);

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

  const currentPermission = await jsonRequest(
    "/api/tenancy/authorize?permission=apps.manage",
    { headers: authorization }
  );
  assert.equal(currentPermission.response.status, 200);
  assert.equal(currentPermission.body.ok, true);
  assert.equal(currentPermission.body.allowed, true);

  const unsafePermissionProbe = await jsonRequest(
    "/api/tenancy/authorize?permission=apps.manage&memberId=someone-else",
    { headers: authorization }
  );
  assert.equal(unsafePermissionProbe.response.status, 400);
  assert.equal(unsafePermissionProbe.body.ok, false);

  const packages = await jsonRequest("/api/platform/packages", {
    headers: authorization
  });
  assert.equal(packages.response.status, 200);
  assert.equal(packages.body.ok, true);
  assert.ok(Array.isArray(packages.body.packages));

  const usability = await jsonRequest(
    "/api/usability/status",
    { headers: authorization }
  );
  assert.equal(usability.response.status, 200);
  assert.equal(usability.body.ok, true);
  assert.equal(usability.body.firstRun, true);
  assert.equal(usability.body.installedApps, 0);
  assert.equal(typeof usability.body.ai.available, "boolean");

  const templates = await jsonRequest(
    "/api/usability/templates",
    { headers: authorization }
  );
  assert.equal(templates.response.status, 200);
  assert.equal(templates.body.ok, true);
  assert.ok(Array.isArray(templates.body.templates));
  assert.ok(templates.body.templates.length >= 4);
  assert.ok(
    templates.body.templates.some(
      (item) => item.id === "crm-basic"
    )
  );

  const installed = await jsonRequest(
    "/api/usability/templates/crm-basic/install",
    {
      method: "POST",
      headers: authorization
    }
  );
  assert.equal(installed.response.status, 200);
  assert.equal(installed.body.ok, true);
  assert.equal(installed.body.templateId, "crm-basic");
  assert.equal(typeof installed.body.app.id, "string");
  const appId = installed.body.app.id;

  const apps = await jsonRequest("/api/apps", {
    headers: authorization
  });
  assert.equal(apps.response.status, 200);
  assert.ok(
    apps.body.apps.some(
      (item) => item.id === appId
    ),
    "template app must appear in normal app listing"
  );

  const missingRequired = await createCustomerRequest(
    appId,
    authorization,
    { name: "Missing Status" }
  );
  assert.equal(missingRequired.response.status, 422);
  assert.equal(missingRequired.body.code, "DATA_VALIDATION_ERROR");
  assert.equal(missingRequired.body.field, "status");

  const invalidEnum = await createCustomerRequest(
    appId,
    authorization,
    {
      name: "Bad Enum",
      status: "NOT_VALID"
    }
  );
  assert.equal(invalidEnum.response.status, 422);
  assert.equal(invalidEnum.body.field, "status");

  const unknownField = await createCustomerRequest(
    appId,
    authorization,
    {
      name: "Unknown Field",
      status: "潜在",
      hacker: "x"
    }
  );
  assert.equal(unknownField.response.status, 422);
  assert.equal(unknownField.body.field, "hacker");

  const emptyRows = await jsonRequest(
    `/api/apps/${encodeURIComponent(appId)}/data/Customer?page=1&pageSize=10`,
    { headers: authorization }
  );
  assert.equal(emptyRows.response.status, 200);
  assert.equal(emptyRows.body.total, 0);

  const createCustomer = await createCustomerRequest(
    appId,
    authorization,
    {
      name: "Day One Customer",
      status: "潜在",
      source: "线上获客"
    }
  );
  assert.equal(createCustomer.response.status, 200);
  assert.equal(createCustomer.body.ok, true);
  assert.equal(createCustomer.body.row.name, "Day One Customer");

  const validCsv = [
    "客户名称,客户状态,来源",
    "批量客户 A,潜在,转介绍",
    "批量客户 B,跟进中,渠道"
  ].join("\n");

  const dryRun = await jsonRequest(
    `/api/apps/${encodeURIComponent(appId)}/data/Customer/import`,
    {
      method: "POST",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        format: "csv",
        csv: validCsv,
        dryRun: true
      })
    }
  );
  assert.equal(dryRun.response.status, 200);
  assert.equal(dryRun.body.ok, true);
  assert.equal(dryRun.body.totalRows, 2);
  assert.equal(dryRun.body.validRows, 2);
  assert.equal(dryRun.body.errorCount, 0);

  const invalidDryRun = await jsonRequest(
    `/api/apps/${encodeURIComponent(appId)}/data/Customer/import`,
    {
      method: "POST",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        format: "csv",
        csv: "客户名称,客户状态\n,不存在",
        dryRun: true
      })
    }
  );
  assert.equal(invalidDryRun.response.status, 422);
  assert.equal(invalidDryRun.body.ok, false);
  assert.equal(invalidDryRun.body.validRows, 0);
  assert.ok(invalidDryRun.body.errorCount >= 2);

  const imported = await jsonRequest(
    `/api/apps/${encodeURIComponent(appId)}/data/Customer/import`,
    {
      method: "POST",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        format: "csv",
        csv: validCsv,
        dryRun: false
      })
    }
  );
  assert.equal(imported.response.status, 200);
  assert.equal(imported.body.ok, true);
  assert.equal(imported.body.imported, 2);
  assert.equal(imported.body.total, 3);

  const customerRows = await jsonRequest(
    `/api/apps/${encodeURIComponent(appId)}/data/Customer?page=1&pageSize=10`,
    { headers: authorization }
  );
  assert.equal(customerRows.response.status, 200);
  assert.equal(customerRows.body.ok, true);
  assert.equal(customerRows.body.total, 3);
  assert.ok(
    customerRows.body.rows.some(
      (item) => item.name === "批量客户 A"
    )
  );

  const jsonExport = await jsonRequest(
    `/api/apps/${encodeURIComponent(appId)}/data/Customer/export?format=json`,
    { headers: authorization }
  );
  assert.equal(jsonExport.response.status, 200);
  assert.equal(jsonExport.body.ok, true);
  assert.equal(jsonExport.body.total, 3);
  assert.equal(jsonExport.body.truncated, false);
  assert.equal(jsonExport.body.rows.length, 3);

  const csvResponse = await fetch(
    `${base}/api/apps/${encodeURIComponent(appId)}/data/Customer/export?format=csv`,
    { headers: authorization }
  );
  assert.equal(csvResponse.status, 200);
  assert.match(
    csvResponse.headers.get("content-type") ?? "",
    /text\/csv/
  );
  const csvExport = await csvResponse.text();
  assert.match(csvExport, /客户名称/);
  assert.match(csvExport, /批量客户 A/);

  const overview = await jsonRequest(
    "/api/platform/data-overview",
    { headers: authorization }
  );
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.ok, true);
  assert.equal(overview.body.totals.apps, 1);
  assert.ok(overview.body.totals.records >= 3);

  const afterTemplate = await jsonRequest(
    "/api/usability/status",
    { headers: authorization }
  );
  assert.equal(afterTemplate.response.status, 200);
  assert.equal(afterTemplate.body.firstRun, false);
  assert.equal(afterTemplate.body.installedApps, 1);

  await access(join(dataDir, "tenancy", "tenancy.sqlite"));
  await access(join(dataDir, "auth", "sessions.sqlite"));
  await access(join(dataDir, "knowledge", "knowledge.sqlite"));
  await access(join(dataDir, "databases", `${appId}.sqlite`));

  console.log(
    "✅ BUILT API + VALIDATION + DATA EXCHANGE E2E TEST PASSED"
  );
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

async function createCustomerRequest(
  appId,
  authorization,
  body
) {
  return jsonRequest(
    `/api/apps/${encodeURIComponent(appId)}/data/Customer`,
    {
      method: "POST",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );
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
