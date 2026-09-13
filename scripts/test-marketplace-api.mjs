import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 19500 + Math.floor(Math.random() * 4000);
const dataDir = await mkdtemp(
  join(tmpdir(), "oeap-marketplace-api-")
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

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForHealth();

  const all = await jsonRequest(
    "/api/marketplace/v1/listings"
  );
  assert.equal(all.response.status, 200);
  assert.equal(all.body.ok, true);
  assert.equal(all.body.items.length, 5);
  assert.deepEqual(
    new Set(all.body.items.map((item) => item.slug)),
    new Set([
      "company-research",
      "lead-generation",
      "opportunity-radar",
      "business-analysis",
      "investment-analysis"
    ])
  );

  const skills = await jsonRequest(
    "/api/marketplace/v1/listings?type=skill"
  );
  assert.equal(skills.response.status, 200);
  assert.deepEqual(
    skills.body.items.map((item) => item.slug),
    ["company-research"]
  );

  const investment = await jsonRequest(
    "/api/marketplace/v1/listings?categories=investment"
  );
  assert.equal(investment.response.status, 200);
  assert.deepEqual(
    investment.body.items.map((item) => item.slug),
    ["investment-analysis"]
  );

  const freePage = await jsonRequest(
    "/api/marketplace/v1/listings?pricingModel=free&limit=2"
  );
  assert.equal(freePage.response.status, 200);
  assert.equal(freePage.body.items.length, 2);
  assert.equal(typeof freePage.body.nextCursor, "string");

  const nextPage = await jsonRequest(
    `/api/marketplace/v1/listings?pricingModel=free&limit=2&cursor=${encodeURIComponent(freePage.body.nextCursor)}`
  );
  assert.equal(nextPage.response.status, 200);
  assert.equal(nextPage.body.items.length, 2);
  assert.equal(
    freePage.body.items.some(
      (left) =>
        nextPage.body.items.some(
          (right) => right.packageId === left.packageId
        )
    ),
    false
  );

  const detail = await jsonRequest(
    "/api/marketplace/v1/listings/oeap.company-research"
  );
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.ok, true);
  assert.equal(
    detail.body.listing.slug,
    "company-research"
  );

  const versions = await jsonRequest(
    "/api/marketplace/v1/listings/oeap.company-research/versions"
  );
  assert.equal(versions.response.status, 200);
  assert.deepEqual(versions.body.versions, []);

  const publisher = await jsonRequest(
    "/api/marketplace/v1/publishers/oeap-official"
  );
  assert.equal(publisher.response.status, 200);
  assert.equal(publisher.body.publisher.verified, true);

  const before = await jsonRequest(
    "/api/marketplace/v1/entitlements"
  );
  assert.equal(before.response.status, 200);
  assert.deepEqual(before.body.entitlements, []);

  const acquired = await jsonRequest(
    "/api/marketplace/v1/listings/oeap.company-research/acquire",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ planId: "free" })
    }
  );
  assert.equal(acquired.response.status, 201);
  assert.equal(acquired.body.ok, true);
  assert.equal(acquired.body.paymentRequired, false);
  assert.equal(
    acquired.body.entitlement.packageId,
    "oeap.company-research"
  );
  assert.equal(acquired.body.entitlement.status, "active");

  const acquiredAgain = await jsonRequest(
    "/api/marketplace/v1/listings/oeap.company-research/acquire",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ planId: "free" })
    }
  );
  assert.equal(acquiredAgain.response.status, 200);
  assert.equal(acquiredAgain.body.alreadyOwned, true);
  assert.equal(
    acquiredAgain.body.entitlement.id,
    acquired.body.entitlement.id
  );

  const entitlements = await jsonRequest(
    "/api/marketplace/v1/entitlements"
  );
  assert.equal(entitlements.response.status, 200);
  assert.equal(entitlements.body.entitlements.length, 1);
  assert.equal(
    entitlements.body.entitlements[0].status,
    "active"
  );

  const orders = await jsonRequest(
    "/api/marketplace/v1/orders"
  );
  assert.equal(orders.response.status, 200);
  assert.deepEqual(orders.body.orders, []);

  const cancelled = await jsonRequest(
    "/api/marketplace/v1/entitlements/oeap.company-research",
    { method: "DELETE" }
  );
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.body.entitlement.status, "cancelled");

  const reacquired = await jsonRequest(
    "/api/marketplace/v1/listings/oeap.company-research/acquire",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ planId: "free" })
    }
  );
  assert.equal(reacquired.response.status, 201);
  assert.equal(reacquired.body.entitlement.status, "active");

  const unknown = await jsonRequest(
    "/api/marketplace/v1/listings/oeap.unknown"
  );
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.body.ok, false);

  const invalidType = await jsonRequest(
    "/api/marketplace/v1/listings?type=not-a-package"
  );
  assert.equal(invalidType.response.status, 400);
  assert.equal(invalidType.body.ok, false);

  const invalidCursor = await jsonRequest(
    "/api/marketplace/v1/listings?cursor=broken"
  );
  assert.equal(invalidCursor.response.status, 400);
  assert.equal(invalidCursor.body.ok, false);

  console.log(
    "✅ MARKETPLACE API TEST PASSED"
  );
} finally {
  child.kill("SIGTERM");
  await waitForExit(child);
  await rm(dataDir, {
    recursive: true,
    force: true
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `API exited before startup (code ${child.exitCode})\n${output}`
      );
    }

    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Startup race; retry until the deadline.
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 100)
    );
  }

  throw new Error(
    `Timed out waiting for API startup\n${output}`
  );
}

async function jsonRequest(path, init) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json();
  return { response, body };
}

async function waitForExit(processHandle) {
  if (processHandle.exitCode !== null) {
    return;
  }

  await Promise.race([
    new Promise((resolve) =>
      processHandle.once("exit", resolve)
    ),
    new Promise((resolve) =>
      setTimeout(resolve, 2_000)
    )
  ]);

  if (processHandle.exitCode === null) {
    processHandle.kill("SIGKILL");
  }
}
