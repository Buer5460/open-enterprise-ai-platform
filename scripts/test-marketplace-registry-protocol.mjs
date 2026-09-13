import assert from "node:assert/strict";

import {
  marketplaceRegistryRoutes,
  validateMarketplaceListing
} from "../packages/package-spec/dist/index.js";

const timestamp = "2026-09-13T00:00:00.000Z";

const freeListing = {
  id: "listing.oeap.company-research",
  packageId: "oeap.company-research",
  packageType: "skill",
  slug: "company-research",
  displayName: "Company Research",
  summary: "Research a company using verifiable sources.",
  publisherId: "oeap",
  latestVersion: "1.0.0",
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
  updatedAt: timestamp
};

assert.deepEqual(
  validateMarketplaceListing(freeListing),
  {
    valid: true,
    errors: []
  }
);

const subscriptionListing = {
  ...freeListing,
  id: "listing.acme.opportunity-radar",
  packageId: "acme.opportunity-radar",
  slug: "opportunity-radar",
  displayName: "Opportunity Radar",
  publisherId: "acme",
  pricing: [
    {
      id: "pro-monthly",
      name: "Pro Monthly",
      model: "subscription",
      currency: "USD",
      amountMinor: 4900,
      interval: "month",
      trialDays: 7
    }
  ]
};

assert.equal(
  validateMarketplaceListing(subscriptionListing).valid,
  true
);

const invalidPaidListing = {
  ...subscriptionListing,
  pricing: [
    {
      id: "broken",
      name: "Broken",
      model: "subscription"
    }
  ]
};

const invalidPaid =
  validateMarketplaceListing(invalidPaidListing);

assert.equal(invalidPaid.valid, false);
assert.ok(
  invalidPaid.errors.some((error) =>
    error.includes("currency")
  )
);
assert.ok(
  invalidPaid.errors.some((error) =>
    error.includes("amountMinor")
  )
);
assert.ok(
  invalidPaid.errors.some((error) =>
    error.includes("interval")
  )
);

const invalidIdentityListing = {
  ...freeListing,
  slug: "Bad Slug",
  pricing: [
    {
      id: "duplicate",
      name: "Free",
      model: "free"
    },
    {
      id: "duplicate",
      name: "Contact",
      model: "contact-sales"
    }
  ]
};

const invalidIdentity =
  validateMarketplaceListing(invalidIdentityListing);

assert.equal(invalidIdentity.valid, false);
assert.ok(
  invalidIdentity.errors.some((error) =>
    error.includes("slug")
  )
);
assert.ok(
  invalidIdentity.errors.some((error) =>
    error.includes("duplicate pricing plan id")
  )
);

assert.equal(
  marketplaceRegistryRoutes.listings,
  "/v1/listings"
);
assert.equal(
  marketplaceRegistryRoutes.listing("acme.pkg/foo"),
  "/v1/listings/acme.pkg%2Ffoo"
);
assert.equal(
  marketplaceRegistryRoutes.version(
    "acme.pkg/foo",
    "1.0.0-beta+1"
  ),
  "/v1/listings/acme.pkg%2Ffoo/versions/1.0.0-beta%2B1"
);
assert.equal(
  marketplaceRegistryRoutes.publisher("acme/team"),
  "/v1/publishers/acme%2Fteam"
);

console.log(
  "✅ MARKETPLACE REGISTRY PROTOCOL TEST PASSED"
);
