import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port =
  24000 + Math.floor(Math.random() * 3000);
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

  const login = await jsonRequest(
    "/api/auth/local",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    }
  );
  assert.equal(login.response.status, 200);

  const authorization = {
    Authorization: `Bearer ${login.body.token}`
  };

  const empty = await jsonRequest(
    "/v1/listings"
  );
  assert.equal(empty.response.status, 200);
  assert.deepEqual(empty.body.items, []);

  const publisher = await jsonRequest(
    "/api/marketplace/registry/publishers",
    {
      method: "POST",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: "acme",
        displayName: "Acme AI",
        website: "https://example.com"
      })
    }
  );
  assert.equal(publisher.response.status, 201);
  assert.equal(publisher.body.publisher.id, "acme");
  assert.equal(
    publisher.body.publisher.verified,
    false
  );

  const listing = await jsonRequest(
    "/api/marketplace/registry/listings/acme.company-research",
    {
      method: "PUT",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        packageType: "skill",
        slug: "company-research",
        displayName: "Company Research",
        summary:
          "Research a company with verifiable sources.",
        publisherId: "acme",
        latestVersion: "1.0.0",
        tags: ["research", "company"],
        categories: ["business-analysis"],
        pricing: [
          {
            id: "free",
            name: "Free",
            model: "free"
          }
        ],
        visibility: "public"
      })
    }
  );
  assert.equal(listing.response.status, 200);
  assert.equal(listing.body.listing.status, "draft");

  const stillPrivate = await jsonRequest(
    "/v1/listings"
  );
  assert.equal(stillPrivate.body.items.length, 0);

  const artifact = await jsonRequest(
    "/api/marketplace/registry/listings/acme.company-research/versions",
    {
      method: "POST",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: "1.0.0",
        downloadUrl:
          "https://example.com/packages/company-research-1.0.0.tgz",
        sha256: "b".repeat(64),
        manifest: {
          schemaVersion: "1.0",
          id: "acme.company-research",
          type: "skill",
          name: "company-research",
          displayName: "Company Research",
          description:
            "Research a company with verifiable sources.",
          version: "1.0.0",
          publisher: "acme",
          execution: {
            mode: "prompt"
          }
        }
      })
    }
  );
  assert.equal(artifact.response.status, 201);
  assert.equal(
    artifact.body.artifact.version,
    "1.0.0"
  );

  const publish = await jsonRequest(
    "/api/marketplace/registry/listings/acme.company-research/publish",
    {
      method: "POST",
      headers: authorization
    }
  );
  assert.equal(publish.response.status, 200);
  assert.equal(
    publish.body.listing.status,
    "published"
  );

  const search = await jsonRequest(
    "/v1/listings?q=company&pricingModel=free"
  );
  assert.equal(search.response.status, 200);
  assert.equal(search.body.items.length, 1);
  assert.equal(
    search.body.items[0].packageId,
    "acme.company-research"
  );

  const publicListing = await jsonRequest(
    "/v1/listings/acme.company-research"
  );
  assert.equal(publicListing.response.status, 200);
  assert.equal(
    publicListing.body.listing.publisherId,
    "acme"
  );

  const publicPublisher = await jsonRequest(
    "/v1/publishers/acme"
  );
  assert.equal(publicPublisher.response.status, 200);
  assert.equal(
    publicPublisher.body.publisher.displayName,
    "Acme AI"
  );

  const publicArtifact = await jsonRequest(
    "/v1/listings/acme.company-research/versions/1.0.0"
  );
  assert.equal(publicArtifact.response.status, 200);
  assert.equal(
    publicArtifact.body.artifact.sha256,
    "b".repeat(64)
  );

  const unpublish = await jsonRequest(
    "/api/marketplace/registry/listings/acme.company-research/unpublish",
    {
      method: "POST",
      headers: authorization
    }
  );
  assert.equal(unpublish.response.status, 200);
  assert.equal(
    unpublish.body.listing.status,
    "draft"
  );

  const hiddenAgain = await jsonRequest(
    "/v1/listings/acme.company-research"
  );
  assert.equal(hiddenAgain.response.status, 404);

  console.log(
    "✅ MARKETPLACE REGISTRY API E2E TEST PASSED"
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) =>
      child.once("exit", resolve)
    ),
    new Promise((resolve) =>
      setTimeout(resolve, 1500)
    )
  ]);
  if (!child.killed) {
    child.kill("SIGKILL");
  }
  await rm(dataDir, {
    recursive: true,
    force: true
  });
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
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 150)
    );
  }

  throw new Error(
    `Timed out waiting for OEAP API\n${output}`
  );
}

async function jsonRequest(
  path,
  init = {}
) {
  const response = await fetch(
    `${base}${path}`,
    init
  );
  const body = await response
    .json()
    .catch(() => ({}));

  return {
    response,
    body
  };
}
