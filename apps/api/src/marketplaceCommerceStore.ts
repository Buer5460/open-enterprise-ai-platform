import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  MarketplacePricingModel,
  MarketplacePricingPlan
} from "@oeap/package-spec";

export type MarketplaceEntitlementStatus =
  | "active"
  | "cancelled"
  | "expired";

export type MarketplaceOrderStatus =
  | "pending"
  | "paid"
  | "failed"
  | "cancelled";

export interface MarketplaceEntitlement {
  id: string;
  organizationId: string;
  packageId: string;
  planId: string;
  pricingModel: MarketplacePricingModel;
  status: MarketplaceEntitlementStatus;
  acquiredAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface MarketplaceOrder {
  id: string;
  organizationId: string;
  packageId: string;
  planId: string;
  pricingModel: MarketplacePricingModel;
  currency?: string;
  amountMinor?: number;
  status: MarketplaceOrderStatus;
  provider: string;
  externalReference?: string;
  checkoutUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export class MarketplaceCommerceStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_entitlements (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        pricing_model TEXT NOT NULL,
        status TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        UNIQUE (organization_id, package_id)
      );

      CREATE INDEX IF NOT EXISTS idx_marketplace_entitlements_org_status
        ON marketplace_entitlements (organization_id, status);

      CREATE TABLE IF NOT EXISTS marketplace_orders (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        pricing_model TEXT NOT NULL,
        currency TEXT,
        amount_minor INTEGER,
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_reference TEXT,
        checkout_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_marketplace_orders_org_created
        ON marketplace_orders (organization_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_marketplace_orders_pending
        ON marketplace_orders (
          organization_id,
          package_id,
          plan_id,
          status
        );
    `);
  }

  getEntitlement(
    organizationId: string,
    packageId: string
  ): MarketplaceEntitlement | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM marketplace_entitlements
      WHERE organization_id = ? AND package_id = ?
    `).get(organizationId, packageId) as any;

    return row ? entitlementFromRow(row) : undefined;
  }

  listEntitlements(
    organizationId: string
  ): MarketplaceEntitlement[] {
    return (this.db.prepare(`
      SELECT *
      FROM marketplace_entitlements
      WHERE organization_id = ?
      ORDER BY acquired_at DESC, package_id ASC
    `).all(organizationId) as any[])
      .map(entitlementFromRow);
  }

  acquireFree(input: {
    organizationId: string;
    packageId: string;
    plan: MarketplacePricingPlan;
  }): MarketplaceEntitlement {
    if (input.plan.model !== "free") {
      throw new Error("acquireFree requires a free pricing plan");
    }

    const existing = this.getEntitlement(
      input.organizationId,
      input.packageId
    );

    if (existing?.status === "active") {
      return existing;
    }

    const now = new Date().toISOString();
    const id = existing?.id ?? `ent_${randomUUID()}`;

    this.db.prepare(`
      INSERT INTO marketplace_entitlements (
        id,
        organization_id,
        package_id,
        plan_id,
        pricing_model,
        status,
        acquired_at,
        updated_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL)
      ON CONFLICT(organization_id, package_id)
      DO UPDATE SET
        plan_id = excluded.plan_id,
        pricing_model = excluded.pricing_model,
        status = 'active',
        updated_at = excluded.updated_at,
        expires_at = NULL
    `).run(
      id,
      input.organizationId,
      input.packageId,
      input.plan.id,
      input.plan.model,
      existing?.acquiredAt ?? now,
      now
    );

    return this.getEntitlement(
      input.organizationId,
      input.packageId
    )!;
  }

  cancelEntitlement(
    organizationId: string,
    packageId: string
  ): MarketplaceEntitlement | undefined {
    const current = this.getEntitlement(
      organizationId,
      packageId
    );

    if (!current) {
      return undefined;
    }

    this.db.prepare(`
      UPDATE marketplace_entitlements
      SET status = 'cancelled', updated_at = ?
      WHERE organization_id = ? AND package_id = ?
    `).run(
      new Date().toISOString(),
      organizationId,
      packageId
    );

    return this.getEntitlement(
      organizationId,
      packageId
    );
  }

  createPendingOrder(input: {
    organizationId: string;
    packageId: string;
    plan: MarketplacePricingPlan;
    provider?: string;
  }): MarketplaceOrder {
    if (input.plan.model === "free") {
      throw new Error("Free plans do not require an order");
    }

    const existing = this.db.prepare(`
      SELECT *
      FROM marketplace_orders
      WHERE organization_id = ?
        AND package_id = ?
        AND plan_id = ?
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(
      input.organizationId,
      input.packageId,
      input.plan.id
    ) as any;

    if (existing) {
      return orderFromRow(existing);
    }

    const now = new Date().toISOString();
    const id = `ord_${randomUUID()}`;

    this.db.prepare(`
      INSERT INTO marketplace_orders (
        id,
        organization_id,
        package_id,
        plan_id,
        pricing_model,
        currency,
        amount_minor,
        status,
        provider,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      id,
      input.organizationId,
      input.packageId,
      input.plan.id,
      input.plan.model,
      input.plan.currency ?? null,
      input.plan.amountMinor ?? null,
      input.provider ?? "unconfigured",
      now,
      now
    );

    return this.getOrder(input.organizationId, id)!;
  }

  getOrder(
    organizationId: string,
    orderId: string
  ): MarketplaceOrder | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM marketplace_orders
      WHERE organization_id = ? AND id = ?
    `).get(organizationId, orderId) as any;

    return row ? orderFromRow(row) : undefined;
  }

  listOrders(
    organizationId: string
  ): MarketplaceOrder[] {
    return (this.db.prepare(`
      SELECT *
      FROM marketplace_orders
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).all(organizationId) as any[])
      .map(orderFromRow);
  }

  completeOrder(input: {
    organizationId: string;
    orderId: string;
    externalReference?: string;
    checkoutUrl?: string;
    expiresAt?: string;
  }): {
    order: MarketplaceOrder;
    entitlement: MarketplaceEntitlement;
  } {
    const order = this.getOrder(
      input.organizationId,
      input.orderId
    );

    if (!order) {
      throw new Error("Marketplace order not found");
    }

    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE marketplace_orders
      SET status = 'paid',
          external_reference = ?,
          checkout_url = ?,
          updated_at = ?
      WHERE organization_id = ? AND id = ?
    `).run(
      input.externalReference ?? order.externalReference ?? null,
      input.checkoutUrl ?? order.checkoutUrl ?? null,
      now,
      input.organizationId,
      order.id
    );

    const current = this.getEntitlement(
      input.organizationId,
      order.packageId
    );
    const entitlementId =
      current?.id ?? `ent_${randomUUID()}`;

    this.db.prepare(`
      INSERT INTO marketplace_entitlements (
        id,
        organization_id,
        package_id,
        plan_id,
        pricing_model,
        status,
        acquired_at,
        updated_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(organization_id, package_id)
      DO UPDATE SET
        plan_id = excluded.plan_id,
        pricing_model = excluded.pricing_model,
        status = 'active',
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `).run(
      entitlementId,
      input.organizationId,
      order.packageId,
      order.planId,
      order.pricingModel,
      current?.acquiredAt ?? now,
      now,
      input.expiresAt ?? null
    );

    return {
      order: this.getOrder(
        input.organizationId,
        order.id
      )!,
      entitlement: this.getEntitlement(
        input.organizationId,
        order.packageId
      )!
    };
  }
}

function entitlementFromRow(
  row: any
): MarketplaceEntitlement {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    packageId: String(row.package_id),
    planId: String(row.plan_id),
    pricingModel: row.pricing_model as MarketplacePricingModel,
    status: row.status as MarketplaceEntitlementStatus,
    acquiredAt: String(row.acquired_at),
    updatedAt: String(row.updated_at),
    ...(row.expires_at
      ? { expiresAt: String(row.expires_at) }
      : {})
  };
}

function orderFromRow(row: any): MarketplaceOrder {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    packageId: String(row.package_id),
    planId: String(row.plan_id),
    pricingModel: row.pricing_model as MarketplacePricingModel,
    ...(row.currency
      ? { currency: String(row.currency) }
      : {}),
    ...(row.amount_minor === null || row.amount_minor === undefined
      ? {}
      : { amountMinor: Number(row.amount_minor) }),
    status: row.status as MarketplaceOrderStatus,
    provider: String(row.provider),
    ...(row.external_reference
      ? { externalReference: String(row.external_reference) }
      : {}),
    ...(row.checkout_url
      ? { checkoutUrl: String(row.checkout_url) }
      : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
