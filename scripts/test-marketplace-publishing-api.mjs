import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 23500 + Math.floor(Math.random() * 2000);
const dataDir = await mkdtemp(join(tmpdir(), "oeap-marketplace-publishing-api-"));
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
      OEAP_DATA_DIR: dataDir,
      OEAP_MARKETPLACE_REVIEW_ORGANIZATIONS: "org_local"
    },
    stdio: ["ignore", "pipe", "pipe"]
  }
);

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await waitForHealth();

  const reviewer = await jsonRequest("/api/marketplace/v1/review/status");
  assert.equal(reviewer.response.status, 200);
  assert.equal(reviewer.body.reviewer, true);

  const account = await jsonRequest(
    "/api/marketplace/v1/publisher/account",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publisherId: "acme-labs",
        displayName: "Acme Labs",
        website: "https://example.com"
      })
    }
  );
  assert.equal(account.response.status, 200);
  assert.equal(account.body.publisher.publisherId, "acme-labs");

  const draft = await jsonRequest(
    "/api/marketplace/v1/publisher/listings/insight-agent",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packageType: "agent",
        displayName: "Insight Agent",
        summary: "Analyze supplied commercial evidence.",
        latestVersion: "1.0.0",
        categories: ["business-intelligence"],
        tags: ["analysis"],
        pricing: [
          { id: "free", name: "Free", model: "free" }
        ]
      })
    }
  );
  assert.equal(draft.response.status, 200);
  assert.equal(draft.body.submission.status, "draft");

  const before = await jsonRequest(
    "/api/marketplace/v1/listings?q=Insight%20Agent"
  );
  assert.equal(before.body.items.length, 0);

  const submitted = await jsonRequest(
    "/api/marketplace/v1/publisher/listings/insight-agent/submit",
    { method: "POST" }
  );
  assert.equal(submitted.response.status, 200);
  assert.equal(submitted.body.submission.status, "submitted");

  const queue = await jsonRequest(
    "/api/marketplace/v1/review/submissions"
  );
  assert.equal(queue.response.status, 200);
  assert.equal(queue.body.submissions.length, 1);

  const approved = await jsonRequest(
    "/api/marketplace/v1/review/submissions/acme-labs.insight-agent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "approve",
        note: "Verified test publisher",
        verifyPublisher: true
      })
    }
  );
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.submission.status, "approved");
  assert.equal(approved.body.publisher.verified, true);

  const publicListing = await jsonRequest(
    "/api/marketplace/v1/listings/acme-labs.insight-agent"
  );
  assert.equal(publicListing.response.status, 200);
  assert.equal(publicListing.body.listing.verified, true);

  const publicPublisher = await jsonRequest(
    "/api/marketplace/v1/publishers/acme-labs"
  );
  assert.equal(publicPublisher.response.status, 200);
  assert.equal(publicPublisher.body.publisher.verified, true);

  const acquired = await jsonRequest(
    "/api/marketplace/v1/listings/acme-labs.insight-agent/acquire",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "free" })
    }
  );
  assert.equal(acquired.response.status, 201);
  assert.equal(acquired.body.entitlement.status, "active");
  assert.equal(acquired.body.activation.status, "metadata-only");

  console.log("✅ MARKETPLACE PUBLISHING API TEST PASSED");
} finally {
  child.kill("SIGTERM");
  await waitForExit(child);
  await rm(dataDir, { recursive: true, force: true });
}

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API exited early (${child.exitCode})\n${output}`);
    }
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for API\n${output}`);
}

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${base}${path}`, init);
  return {
    response,
    body: await response.json()
  };
}

async function waitForExit(process) {
  if (process.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => process.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
}
