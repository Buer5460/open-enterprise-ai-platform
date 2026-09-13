import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MarketplaceCommerceStore
} from "../apps/api/dist/marketplaceCommerceStore.js";

const root = await mkdtemp(
  join(tmpdir(), "oeap-marketplace-commerce-")
);

try {
  const store = new MarketplaceCommerceStore(
    join(root, "commerce.sqlite")
  );

  const freePlan = {
    id: "free",
    name: "Free",
    model: "free"
  };

  const first = store.acquireFree({
    organizationId: "org_test",
    packageId: "oeap.company-research",
    plan: freePlan
  });

  assert.equal(first.status, "active");
  assert.equal(first.planId, "free");

  const second = store.acquireFree({
    organizationId: "org_test",
    packageId: "oeap.company-research",
    plan: freePlan
  });

  assert.equal(second.id, first.id);
  assert.equal(
    store.listEntitlements("org_test").length,
    1
  );

  const cancelled = store.cancelEntitlement(
    "org_test",
    "oeap.company-research"
  );
  assert.equal(cancelled?.status, "cancelled");

  const reacquired = store.acquireFree({
    organizationId: "org_test",
    packageId: "oeap.company-research",
    plan: freePlan
  });
  assert.equal(reacquired.status, "active");
  assert.equal(reacquired.id, first.id);

  const paidPlan = {
    id: "pro-monthly",
    name: "Pro Monthly",
    model: "subscription",
    currency: "USD",
    amountMinor: 4900,
    interval: "month"
  };

  const pending = store.createPendingOrder({
    organizationId: "org_test",
    packageId: "vendor.pro-agent",
    plan: paidPlan
  });

  assert.equal(pending.status, "pending");
  assert.equal(pending.amountMinor, 4900);
  assert.equal(pending.currency, "USD");
  assert.equal(pending.provider, "unconfigured");

  const pendingAgain = store.createPendingOrder({
    organizationId: "org_test",
    packageId: "vendor.pro-agent",
    plan: paidPlan
  });
  assert.equal(pendingAgain.id, pending.id);

  const completed = store.completeOrder({
    organizationId: "org_test",
    orderId: pending.id,
    externalReference: "pay_test_123"
  });

  assert.equal(completed.order.status, "paid");
  assert.equal(
    completed.order.externalReference,
    "pay_test_123"
  );
  assert.equal(completed.entitlement.status, "active");
  assert.equal(
    completed.entitlement.packageId,
    "vendor.pro-agent"
  );
  assert.equal(
    completed.entitlement.pricingModel,
    "subscription"
  );

  assert.equal(store.listOrders("org_test").length, 1);
  assert.equal(
    store.getOrder("org_other", pending.id),
    undefined
  );
  assert.equal(
    store.getEntitlement(
      "org_other",
      "oeap.company-research"
    ),
    undefined
  );

  console.log(
    "✅ MARKETPLACE COMMERCE TEST PASSED"
  );
} finally {
  await rm(root, {
    recursive: true,
    force: true
  });
}
