import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MarketplaceRegistryStore
} from "../apps/api/dist/marketplaceRegistryStore.js";

const root = await mkdtemp(
  join(tmpdir(), "oeap-marketplace-registry-")
);

try {
  const store = new MarketplaceRegistryStore(
    join(root, "registry.sqlite")
  );

  const publisher = store.upsertPublisher(
    "org_a",
    {
      id: "acme",
      displayName: "Acme AI",
      website: "https://example.com"
    }
  );

  assert.equal(publisher.id, "acme");
  assert.equal(publisher.verified, false);

  assert.throws(
    () =>
      store.upsertPublisher(
        "org_b",
        {
          id: "acme",
          displayName: "Imposter"
        }
      ),
    /owned by another organization/
  );

  const now = "2026-09-13T00:00:00.000Z";
  const draft = store.upsertListing(
    "org_a",
    {
      id: "listing.acme.company-research",
      packageId: "acme.company-research",
      packageType: "skill",
      slug: "company-research",
      displayName: "Company Research",
      summary: "Research a company with verifiable sources.",
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
      visibility: "public",
      status: "draft",
      createdAt: now,
      updatedAt: now
    }
  );

  assert.equal(draft.status, "draft");
  assert.equal(
    store.searchPublicListings({}).items.length,
    0
  );

  store.addArtifact(
    "org_a",
    {
      packageId: "acme.company-research",
      version: "1.0.0",
      downloadUrl:
        "https://example.com/packages/company-research-1.0.0.tgz",
      sha256: "a".repeat(64),
      manifest: {
        schemaVersion: "1.0",
        id: "acme.company-research",
        type: "skill",
        name: "company-research",
        version: "1.0.0",
        publisher: "acme"
      },
      publishedAt: now
    }
  );

  const published = store.publishListing(
    "org_a",
    "acme.company-research"
  );
  assert.equal(published.status, "published");

  const search = store.searchPublicListings({
    q: "verifiable",
    pricingModel: "free"
  });
  assert.equal(search.items.length, 1);
  assert.equal(
    search.items[0]?.packageId,
    "acme.company-research"
  );

  assert.equal(
    store.getPublicPublisher("acme")?.displayName,
    "Acme AI"
  );
  assert.equal(
    store.getPublicArtifact(
      "acme.company-research",
      "1.0.0"
    )?.sha256,
    "a".repeat(64)
  );

  const unlistedDraft = store.upsertListing(
    "org_a",
    {
      ...published,
      visibility: "unlisted",
      status: "draft",
      updatedAt: now
    }
  );
  assert.equal(unlistedDraft.visibility, "unlisted");
  store.publishListing(
    "org_a",
    "acme.company-research"
  );

  assert.equal(
    store.searchPublicListings({}).items.length,
    0
  );
  assert.equal(
    store.getPublicListing(
      "acme.company-research"
    )?.visibility,
    "unlisted"
  );

  const privateDraft = store.upsertListing(
    "org_a",
    {
      ...unlistedDraft,
      visibility: "private",
      status: "draft",
      updatedAt: now
    }
  );
  assert.equal(privateDraft.visibility, "private");
  store.publishListing(
    "org_a",
    "acme.company-research"
  );

  assert.equal(
    store.getPublicListing(
      "acme.company-research"
    ),
    undefined
  );
  assert.equal(
    store.getManagedListing(
      "org_a",
      "acme.company-research"
    )?.visibility,
    "private"
  );

  store.unpublishListing(
    "org_a",
    "acme.company-research"
  );
  assert.equal(
    store.getManagedListing(
      "org_a",
      "acme.company-research"
    )?.status,
    "draft"
  );

  console.log(
    "✅ MARKETPLACE REGISTRY STORE TEST PASSED"
  );
} finally {
  await rm(root, {
    recursive: true,
    force: true
  });
}
