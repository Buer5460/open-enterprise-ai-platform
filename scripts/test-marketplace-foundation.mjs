import assert from "node:assert/strict";

import {
  InMemoryMarketplaceRegistry,
  MarketplaceRegistryValidationError,
  createOfficialMarketplaceRegistry,
  officialMarketplaceListings
} from "../packages/marketplace-registry/dist/index.js";

import {
  validateMarketplaceListing
} from "../packages/package-spec/dist/index.js";

const timestamp = "2026-09-13T00:00:00.000Z";

function listing(overrides = {}) {
  return {
    id: "listing.test.company-research",
    packageId: "test.company-research",
    packageType: "skill",
    slug: "company-research",
    displayName: "Company Research",
    summary: "Research companies from verifiable sources.",
    publisherId: "test-publisher",
    latestVersion: "1.0.0",
    tags: ["company", "research"],
    categories: ["research"],
    pricing: [
      {
        id: "free",
        name: "Free",
        model: "free"
      }
    ],
    visibility: "public",
    status: "published",
    installCount: 0,
    rating: {
      average: 0,
      count: 0
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

const valid = listing();
assert.deepEqual(
  validateMarketplaceListing(valid),
  { valid: true, errors: [] }
);

const invalidSlug = validateMarketplaceListing(
  listing({ slug: "Bad Slug" })
);
assert.equal(invalidSlug.valid, false);
assert.ok(
  invalidSlug.errors.some((error) =>
    error.includes("slug")
  )
);

const duplicatePricing = validateMarketplaceListing(
  listing({
    pricing: [
      { id: "same", name: "Free", model: "free" },
      { id: "same", name: "Sales", model: "contact-sales" }
    ]
  })
);
assert.equal(duplicatePricing.valid, false);
assert.ok(
  duplicatePricing.errors.some((error) =>
    error.includes("duplicate pricing plan id")
  )
);

const missingInterval = validateMarketplaceListing(
  listing({
    pricing: [
      {
        id: "pro",
        name: "Pro",
        model: "subscription",
        currency: "USD",
        amountMinor: 4900
      }
    ]
  })
);
assert.equal(missingInterval.valid, false);
assert.ok(
  missingInterval.errors.some((error) =>
    error.includes("interval")
  )
);

const missingCurrency = validateMarketplaceListing(
  listing({
    pricing: [
      {
        id: "paid",
        name: "Paid",
        model: "one-time",
        amountMinor: 9900
      }
    ]
  })
);
assert.equal(missingCurrency.valid, false);
assert.ok(
  missingCurrency.errors.some((error) =>
    error.includes("currency")
  )
);

const invalidRating = validateMarketplaceListing(
  listing({
    rating: {
      average: 5.5,
      count: -1
    }
  })
);
assert.equal(invalidRating.valid, false);
assert.ok(
  invalidRating.errors.some((error) =>
    error.includes("rating.average")
  )
);
assert.ok(
  invalidRating.errors.some((error) =>
    error.includes("rating.count")
  )
);

const registry = new InMemoryMarketplaceRegistry({
  publishers: [
    {
      id: "test-publisher",
      displayName: "Test Publisher",
      verified: true
    }
  ]
});

await registry.upsertListing(valid);
await registry.upsertListing(
  listing({
    id: "listing.test.lead-generation",
    packageId: "test.lead-generation",
    packageType: "agent",
    slug: "lead-generation",
    displayName: "Lead Generation",
    summary: "Generate B2B leads.",
    tags: ["sales", "leads"],
    categories: ["sales", "growth"],
    pricing: [
      {
        id: "pro-monthly",
        name: "Pro Monthly",
        model: "subscription",
        currency: "USD",
        amountMinor: 4900,
        interval: "month"
      }
    ]
  })
);
await registry.upsertListing(
  listing({
    id: "listing.test.business-analysis",
    packageId: "test.business-analysis",
    packageType: "agent",
    slug: "business-analysis",
    displayName: "Business Analysis",
    summary: "Analyze business opportunities.",
    tags: ["strategy"],
    categories: ["strategy"]
  })
);

const agents = await registry.search({ type: "agent" });
assert.deepEqual(
  new Set(agents.items.map((item) => item.slug)),
  new Set(["lead-generation", "business-analysis"])
);

const sales = await registry.search({
  categories: ["sales"]
});
assert.deepEqual(
  sales.items.map((item) => item.slug),
  ["lead-generation"]
);

const subscriptions = await registry.search({
  pricingModel: "subscription"
});
assert.deepEqual(
  subscriptions.items.map((item) => item.slug),
  ["lead-generation"]
);

const researched = await registry.search({
  q: "verifiable"
});
assert.deepEqual(
  researched.items.map((item) => item.slug),
  ["company-research"]
);

const firstPage = await registry.search({ limit: 1 });
assert.equal(firstPage.items.length, 1);
assert.equal(typeof firstPage.nextCursor, "string");
const secondPage = await registry.search({
  limit: 1,
  cursor: firstPage.nextCursor
});
assert.equal(secondPage.items.length, 1);
assert.notEqual(
  firstPage.items[0].packageId,
  secondPage.items[0].packageId
);

await assert.rejects(
  registry.upsertListing(
    listing({
      packageId: "test.invalid",
      slug: "Invalid Slug"
    })
  ),
  (error) =>
    error instanceof MarketplaceRegistryValidationError &&
    error.errors.some((item) => item.includes("slug"))
);

const artifact = {
  packageId: "test.company-research",
  version: "1.0.0",
  downloadUrl: "https://example.test/company-research-1.0.0.tgz",
  sha256: "a".repeat(64),
  manifest: {
    schemaVersion: "1.0",
    id: "test.company-research",
    type: "skill",
    name: "company-research",
    version: "1.0.0",
    publisher: "test-publisher"
  },
  publishedAt: timestamp
};

await registry.publishArtifact(artifact);
assert.deepEqual(
  await registry.getArtifact(
    "test.company-research",
    "1.0.0"
  ),
  artifact
);
assert.equal(
  (await registry.listVersions("test.company-research"))[0].version,
  "1.0.0"
);
assert.equal(
  await registry.getArtifact(
    "test.company-research",
    "9.9.9"
  ),
  null
);
assert.equal(
  await registry.getListing("test.unknown"),
  null
);

const official = createOfficialMarketplaceRegistry();
const officialSearch = await official.search({
  publisherId: "oeap-official",
  limit: 20
});
assert.equal(officialSearch.items.length, 6);
assert.deepEqual(
  new Set(officialSearch.items.map((item) => item.slug)),
  new Set([
    "company-research",
    "lead-generation",
    "opportunity-radar",
    "business-analysis",
    "b2b-opportunity-workflow",
    "investment-analysis"
  ])
);
assert.equal(officialMarketplaceListings.length, 6);

console.log(
  "✅ MARKETPLACE FOUNDATION TEST PASSED"
);
