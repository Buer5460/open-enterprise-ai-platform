import {
  createHash,
  createHmac,
  timingSafeEqual
} from "node:crypto";

import type {
  MarketplacePaymentEventType
} from "./marketplaceCommerceStore.js";

export interface MarketplacePaymentWebhookEvent {
  providerEventId: string;
  orderId: string;
  type: MarketplacePaymentEventType;
  occurredAt: string;
  externalReference?: string;
  expiresAt?: string;
}

export type VerifiedMarketplacePaymentWebhook = {
  event: MarketplacePaymentWebhookEvent;
  payloadDigest: string;
  signatureTimestamp: number;
};

export class MarketplacePaymentWebhookError
extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_PROVIDER"
      | "PROVIDER_NOT_CONFIGURED"
      | "INVALID_TIMESTAMP"
      | "TIMESTAMP_OUTSIDE_WINDOW"
      | "INVALID_SIGNATURE"
      | "INVALID_EVENT"
  ) {
    super(message);
    this.name = "MarketplacePaymentWebhookError";
  }
}

const allowedEventTypes = new Set<MarketplacePaymentEventType>([
  "payment.succeeded",
  "payment.failed",
  "payment.cancelled"
]);

const allowedBodyKeys = new Set([
  "providerEventId",
  "orderId",
  "type",
  "occurredAt",
  "externalReference",
  "expiresAt"
]);

export function configuredMarketplacePaymentProvider():
  | string
  | undefined {
  const value =
    process.env.OEAP_MARKETPLACE_PAYMENT_PROVIDER?.trim();

  if (!value) return undefined;

  const provider = normalizeProvider(value);
  return paymentWebhookSecret(provider)
    ? provider
    : undefined;
}

export function paymentWebhookConfigured(
  providerInput: string
): boolean {
  try {
    return Boolean(
      paymentWebhookSecret(
        normalizeProvider(providerInput)
      )
    );
  } catch {
    return false;
  }
}

export function verifyMarketplacePaymentWebhook(input: {
  provider: string;
  timestampHeader?: string;
  signatureHeader?: string;
  body: unknown;
  nowMs?: number;
}): VerifiedMarketplacePaymentWebhook {
  const provider = normalizeProvider(input.provider);
  const secret = paymentWebhookSecret(provider);

  if (!secret) {
    throw new MarketplacePaymentWebhookError(
      "Marketplace payment webhook provider is not configured",
      "PROVIDER_NOT_CONFIGURED"
    );
  }

  const timestamp = parseSignatureTimestamp(
    input.timestampHeader
  );
  const nowMs = input.nowMs ?? Date.now();
  const tolerance = webhookToleranceSeconds();

  if (
    Math.abs(Math.floor(nowMs / 1000) - timestamp) >
    tolerance
  ) {
    throw new MarketplacePaymentWebhookError(
      "Marketplace payment webhook timestamp is outside the accepted window",
      "TIMESTAMP_OUTSIDE_WINDOW"
    );
  }

  const event = parsePaymentEvent(input.body);
  const canonical = canonicalMarketplacePaymentEvent(event);
  const expected = hmacSignature(
    secret,
    timestamp,
    canonical
  );
  const supplied = parseSignature(
    input.signatureHeader
  );

  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(supplied, "hex");

  if (
    expectedBytes.length !== suppliedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)
  ) {
    throw new MarketplacePaymentWebhookError(
      "Marketplace payment webhook signature is invalid",
      "INVALID_SIGNATURE"
    );
  }

  return {
    event,
    signatureTimestamp: timestamp,
    payloadDigest: createHash("sha256")
      .update(canonical, "utf8")
      .digest("hex")
  };
}

export function signMarketplacePaymentEvent(input: {
  secret: string;
  timestamp: number;
  event: MarketplacePaymentWebhookEvent;
}): string {
  const secret = normalizeSecret(input.secret);
  const event = parsePaymentEvent(input.event);
  return `v1=${hmacSignature(
    secret,
    input.timestamp,
    canonicalMarketplacePaymentEvent(event)
  )}`;
}

export function canonicalMarketplacePaymentEvent(
  input: MarketplacePaymentWebhookEvent
): string {
  const event = parsePaymentEvent(input);

  // Key order is part of the provider-neutral protocol. Do not sign arbitrary
  // raw request serialization because different JSON encoders can reorder keys.
  return JSON.stringify({
    providerEventId: event.providerEventId,
    orderId: event.orderId,
    type: event.type,
    occurredAt: event.occurredAt,
    externalReference:
      event.externalReference ?? null,
    expiresAt:
      event.expiresAt ?? null
  });
}

export function marketplacePaymentProviderId(
  input: string
): string {
  return normalizeProvider(input);
}

function parsePaymentEvent(
  value: unknown
): MarketplacePaymentWebhookEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidEvent("Payment webhook body must be a JSON object");
  }

  const body = value as Record<string, unknown>;
  const unknown = Object.keys(body)
    .filter((key) => !allowedBodyKeys.has(key));

  if (unknown.length > 0) {
    throw invalidEvent(
      `Unknown payment webhook field(s): ${unknown.join(", ")}`
    );
  }

  const providerEventId = requiredText(
    body.providerEventId,
    "providerEventId",
    200
  );
  const orderId = requiredText(
    body.orderId,
    "orderId",
    120
  );

  if (!/^ord_[0-9a-f-]{20,}$/i.test(orderId)) {
    throw invalidEvent("orderId is invalid");
  }

  const type = requiredText(
    body.type,
    "type",
    80
  ) as MarketplacePaymentEventType;

  if (!allowedEventTypes.has(type)) {
    throw invalidEvent("Payment webhook event type is unsupported");
  }

  const occurredAt = timestamp(
    body.occurredAt,
    "occurredAt"
  );
  const externalReference = optionalText(
    body.externalReference,
    "externalReference",
    500
  );
  const expiresAt =
    body.expiresAt === undefined ||
    body.expiresAt === null ||
    body.expiresAt === ""
      ? undefined
      : timestamp(body.expiresAt, "expiresAt");

  return {
    providerEventId,
    orderId,
    type,
    occurredAt,
    ...(externalReference
      ? { externalReference }
      : {}),
    ...(expiresAt
      ? { expiresAt }
      : {})
  };
}

function parseSignatureTimestamp(
  value: string | undefined
): number {
  if (!value?.trim() || !/^\d{10,13}$/.test(value.trim())) {
    throw new MarketplacePaymentWebhookError(
      "x-oeap-payment-timestamp is invalid",
      "INVALID_TIMESTAMP"
    );
  }

  const parsed = Number(value.trim());
  const seconds = parsed > 9_999_999_999
    ? Math.floor(parsed / 1000)
    : parsed;

  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new MarketplacePaymentWebhookError(
      "x-oeap-payment-timestamp is invalid",
      "INVALID_TIMESTAMP"
    );
  }

  return seconds;
}

function parseSignature(
  value: string | undefined
): string {
  const match = /^v1=([a-f0-9]{64})$/i.exec(
    value?.trim() ?? ""
  );

  if (!match) {
    throw new MarketplacePaymentWebhookError(
      "x-oeap-payment-signature is invalid",
      "INVALID_SIGNATURE"
    );
  }

  return match[1].toLowerCase();
}

function hmacSignature(
  secret: string,
  timestamp: number,
  canonicalPayload: string
): string {
  return createHmac("sha256", secret)
    .update(`${Math.trunc(timestamp)}.${canonicalPayload}`, "utf8")
    .digest("hex");
}

function paymentWebhookSecret(
  provider: string
): string | undefined {
  const suffix = provider
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_");
  const providerSpecific =
    process.env[
      `OEAP_MARKETPLACE_PAYMENT_WEBHOOK_SECRET_${suffix}`
    ]?.trim();
  const fallback =
    process.env.OEAP_MARKETPLACE_PAYMENT_WEBHOOK_SECRET
      ?.trim();
  const value = providerSpecific || fallback;

  if (!value) return undefined;
  return normalizeSecret(value);
}

function normalizeSecret(
  value: string
): string {
  const secret = value.trim();
  if (secret.length < 32 || secret.length > 4096) {
    throw new MarketplacePaymentWebhookError(
      "Marketplace payment webhook secret must be at least 32 characters",
      "PROVIDER_NOT_CONFIGURED"
    );
  }
  return secret;
}

function webhookToleranceSeconds(): number {
  const requested = Number(
    process.env.OEAP_MARKETPLACE_PAYMENT_WEBHOOK_TOLERANCE_SECONDS ??
    300
  );

  return Number.isFinite(requested)
    ? Math.min(
        Math.max(Math.trunc(requested), 60),
        900
      )
    : 300;
}

function normalizeProvider(
  value: string
): string {
  const provider = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider)) {
    throw new MarketplacePaymentWebhookError(
      "Marketplace payment provider id is invalid",
      "INVALID_PROVIDER"
    );
  }
  return provider;
}

function requiredText(
  value: unknown,
  field: string,
  maximum: number
): string {
  if (typeof value !== "string") {
    throw invalidEvent(`${field} is required`);
  }

  const text = value.trim();
  if (!text || text.length > maximum || /[\r\n\0]/.test(text)) {
    throw invalidEvent(`${field} is invalid`);
  }
  return text;
}

function optionalText(
  value: unknown,
  field: string,
  maximum: number
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw invalidEvent(`${field} must be a string`);
  }
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > maximum || /[\0]/.test(text)) {
    throw invalidEvent(`${field} is invalid`);
  }
  return text;
}

function timestamp(
  value: unknown,
  field: string
): string {
  if (typeof value !== "string") {
    throw invalidEvent(`${field} is required`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw invalidEvent(`${field} must be a valid timestamp`);
  }
  return new Date(parsed).toISOString();
}

function invalidEvent(
  message: string
): MarketplacePaymentWebhookError {
  return new MarketplacePaymentWebhookError(
    message,
    "INVALID_EVENT"
  );
}
