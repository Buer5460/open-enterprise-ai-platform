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

export type MarketplacePaymentEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.cancelled";

export type MarketplacePaymentEventStatus =
  | "processed"
  | "rejected";

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

export interface MarketplacePaymentEvent {
  id: string;
  provider: string;
  providerEventId: string;
  orderId: string;
  organizationId: string;
  eventType: MarketplacePaymentEventType;
  payloadDigest: string;
  status: MarketplacePaymentEventStatus;
  externalReference?: string;
  occurredAt: string;
  receivedAt: string;
  processedAt?: string;
  error?: string;
}

export type MarketplacePaymentEventResult = {
  duplicate: boolean;
  event: MarketplacePaymentEvent;
  order: MarketplaceOrder;
  entitlement?: MarketplaceEntitlement;
};

export class MarketplacePaymentEventConflictError
extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplacePaymentEventConflictError";
  }
}

export class MarketplaceCommerceStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;

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

      CREATE TABLE IF NOT EXISTS marketplace_payment_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_event_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        status TEXT NOT NULL,
        external_reference TEXT,
        occurred_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        processed_at TEXT,
        error TEXT,
        UNIQUE (provider, provider_event_id)
      );

      CREATE INDEX IF NOT EXISTS idx_marketplace_payment_events_order
        ON marketplace_payment_events (
          order_id,
          received_at DESC
        );

      CREATE INDEX IF NOT EXISTS idx_marketplace_payment_events_org
        ON marketplace_payment_events (
          organization_id,
          received_at DESC
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

    const provider = normalizeProvider(
      input.provider ?? "unconfigured"
    );

    const existing = this.db.prepare(`
      SELECT *
      FROM marketplace_orders
      WHERE organization_id = ?
        AND package_id = ?
        AND plan_id = ?
        AND provider = ?
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(
      input.organizationId,
      input.packageId,
      input.plan.id,
      provider
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
      provider,
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

  getOrderById(
    orderId: string
  ): MarketplaceOrder | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM marketplace_orders
      WHERE id = ?
    `).get(orderId) as any;

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

  listPaymentEvents(
    organizationId: string,
    limit = 100
  ): MarketplacePaymentEvent[] {
    const bounded = Math.min(
      Math.max(Math.trunc(limit), 1),
      500
    );

    return (this.db.prepare(`
      SELECT *
      FROM marketplace_payment_events
      WHERE organization_id = ?
      ORDER BY received_at DESC, id DESC
      LIMIT ?
    `).all(
      organizationId,
      bounded
    ) as any[]).map(paymentEventFromRow);
  }

  getPaymentEvent(
    provider: string,
    providerEventId: string
  ): MarketplacePaymentEvent | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM marketplace_payment_events
      WHERE provider = ? AND provider_event_id = ?
    `).get(
      normalizeProvider(provider),
      providerEventId
    ) as any;

    return row ? paymentEventFromRow(row) : undefined;
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
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.completeOrderInTransaction(input);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  processVerifiedPaymentEvent(input: {
    provider: string;
    providerEventId: string;
    orderId: string;
    eventType: MarketplacePaymentEventType;
    payloadDigest: string;
    occurredAt: string;
    externalReference?: string;
    expiresAt?: string;
  }): MarketplacePaymentEventResult {
    const provider = normalizeProvider(input.provider);
    const eventId = normalizeEventId(input.providerEventId);
    const digest = normalizeDigest(input.payloadDigest);
    const occurredAt = normalizeTimestamp(
      input.occurredAt,
      "occurredAt"
    );
    const receivedAt = new Date().toISOString();

    const existing = this.getPaymentEvent(
      provider,
      eventId
    );

    if (existing) {
      if (
        existing.payloadDigest !== digest ||
        existing.orderId !== input.orderId ||
        existing.eventType !== input.eventType
      ) {
        throw new MarketplacePaymentEventConflictError(
          "Payment provider event id was replayed with different content"
        );
      }

      const order = this.getOrderById(existing.orderId);
      if (!order) {
        throw new MarketplacePaymentEventConflictError(
          "Previously processed payment event references a missing order"
        );
      }

      return {
        duplicate: true,
        event: existing,
        order,
        entitlement:
          order.status === "paid"
            ? this.getEntitlement(
                order.organizationId,
                order.packageId
              )
            : undefined
      };
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const order = this.getOrderById(input.orderId);
      if (!order) {
        throw new Error("Marketplace order not found");
      }

      if (order.provider !== provider) {
        throw new MarketplacePaymentEventConflictError(
          `Payment provider mismatch: order expects ${order.provider}`
        );
      }

      const id = `evt_${randomUUID()}`;
      this.db.prepare(`
        INSERT INTO marketplace_payment_events (
          id,
          provider,
          provider_event_id,
          order_id,
          organization_id,
          event_type,
          payload_digest,
          status,
          external_reference,
          occurred_at,
          received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'processed', ?, ?, ?)
      `).run(
        id,
        provider,
        eventId,
        order.id,
        order.organizationId,
        input.eventType,
        digest,
        normalizeOptionalText(input.externalReference, 500),
        occurredAt,
        receivedAt
      );

      let finalOrder: MarketplaceOrder;
      let entitlement: MarketplaceEntitlement | undefined;

      if (input.eventType === "payment.succeeded") {
        const completed = this.completeOrderInTransaction({
          organizationId: order.organizationId,
          orderId: order.id,
          externalReference: input.externalReference,
          expiresAt: input.expiresAt
        });
        finalOrder = completed.order;
        entitlement = completed.entitlement;
      } else {
        const nextStatus: MarketplaceOrderStatus =
          input.eventType === "payment.failed"
            ? "failed"
            : "cancelled";

        if (order.status === "paid") {
          throw new MarketplacePaymentEventConflictError(
            "A paid order cannot be changed by a later failure/cancellation event"
          );
        }

        this.db.prepare(`
          UPDATE marketplace_orders
          SET status = ?,
              external_reference = COALESCE(?, external_reference),
              updated_at = ?
          WHERE id = ?
        `).run(
          nextStatus,
          normalizeOptionalText(input.externalReference, 500),
          new Date().toISOString(),
          order.id
        );
        finalOrder = this.getOrderById(order.id)!;
      }

      const processedAt = new Date().toISOString();
      this.db.prepare(`
        UPDATE marketplace_payment_events
        SET processed_at = ?
        WHERE id = ?
      `).run(processedAt, id);

      this.db.exec("COMMIT");

      return {
        duplicate: false,
        event: this.getPaymentEvent(provider, eventId)!,
        order: finalOrder,
        entitlement
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private completeOrderInTransaction(input: {
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

    if (
      order.status === "failed" ||
      order.status === "cancelled"
    ) {
      throw new MarketplacePaymentEventConflictError(
        `Marketplace order cannot be paid from status ${order.status}`
      );
    }

    if (input.expiresAt) {
      normalizeTimestamp(input.expiresAt, "expiresAt");
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
      normalizeOptionalText(
        input.externalReference ?? order.externalReference,
        500
      ),
      normalizeOptionalText(
        input.checkoutUrl ?? order.checkoutUrl,
        2000
      ),
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

function normalizeProvider(value: string): string {
  const provider = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider)) {
    throw new Error("Marketplace payment provider id is invalid");
  }
  return provider;
}

function normalizeEventId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 200 || /[\r\n\0]/.test(id)) {
    throw new Error("Marketplace payment provider event id is invalid");
  }
  return id;
}

function normalizeDigest(value: string): string {
  const digest = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("Marketplace payment payload digest is invalid");
  }
  return digest;
}

function normalizeTimestamp(
  value: string,
  field: string
): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return new Date(time).toISOString();
}

function normalizeOptionalText(
  value: string | undefined,
  maximum: number
): string | null {
  if (value === undefined) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length > maximum || /[\0]/.test(text)) {
    throw new Error("Marketplace payment reference value is invalid");
  }
  return text;
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

function paymentEventFromRow(
  row: any
): MarketplacePaymentEvent {
  return {
    id: String(row.id),
    provider: String(row.provider),
    providerEventId: String(row.provider_event_id),
    orderId: String(row.order_id),
    organizationId: String(row.organization_id),
    eventType:
      row.event_type as MarketplacePaymentEventType,
    payloadDigest: String(row.payload_digest),
    status:
      row.status as MarketplacePaymentEventStatus,
    ...(row.external_reference
      ? { externalReference: String(row.external_reference) }
      : {}),
    occurredAt: String(row.occurred_at),
    receivedAt: String(row.received_at),
    ...(row.processed_at
      ? { processedAt: String(row.processed_at) }
      : {}),
    ...(row.error
      ? { error: String(row.error) }
      : {})
  };
}
