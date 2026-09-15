import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MarketplacePublishingStore
} from "../apps/api/dist/marketplacePublishingStore.js";

const root = await mkdtemp(join(tmpdir(), "oeap-publisher-store-"));
const database = join(root, "publishing.sqlite");

try {
  const store = new MarketplacePublishingStore(database);
  const publisher = store.upsertPublisher({
    organizationId: "org-a",
    publisherId: "acme-labs",
    displayName: "Acme Labs",
    website: "https://example.com"
  });
  assert.equal(publisher.publisherId, "acme-labs");
  assert.equal(publisher.verified, false);

  assert.throws(
    () => store.upsertPublisher({
      organizationId: "org-b",
      publisherId: "acme-labs",
      displayName: "Imposter"
    }),
    /already owned/
  );

  const now = "2026-09-15T00:00:00.000Z";
  const listing = {
    id: "listing.acme-labs.insight-agent",
    packageId: "acme-labs.insight-agent",
    packageType: "agent",
    slug: "insight-agent",
    displayName: "Insight Agent",
    summary: "Analyze supplied business evidence.",
    publisherId: "acme-labs",
    latestVersion: "1.0.0",
    tags: ["analysis"],
    categories: ["business-intelligence"],
    pricing: [{ id: "free", name: "Free", model: "free" }],
    license: { model: "proprietary", requiresEntitlement: true },
    visibility: "public",
    status: "draft",
    verified: false,
    installCount: 0,
    rating: { average: 0, count: 0 },
    createdAt: now,
    updatedAt: now
  };

  const draft = store.saveDraft({
    organizationId: "org-a",
    publisherId: "acme-labs",
    listing
  });
  assert.equal(draft.status, "draft");

  const submitted = store.submit(
    "org-a",
    listing.packageId
  );
  assert.equal(submitted.status, "submitted");
  assert.equal(store.listReviewQueue().length, 1);

  const reviewed = store.review({
    packageId: listing.packageId,
    decision: "approve",
    note: "Approved in test",
    verifyPublisher: true
  });
  assert.equal(reviewed.submission.status, "approved");
  assert.equal(reviewed.submission.listing.status, "published");
  assert.equal(reviewed.publisher.verified, true);

  const reopened = new MarketplacePublishingStore(database);
  const approved = reopened.listApprovedEntries();
  assert.equal(approved.length, 1);
  assert.equal(approved[0].listing.packageId, listing.packageId);
  assert.equal(approved[0].publisher.verified, true);

  console.log("✅ MARKETPLACE PUBLISHING STORE TEST PASSED");
} finally {
  await rm(root, { recursive: true, force: true });
}
