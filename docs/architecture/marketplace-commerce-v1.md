# Marketplace Commerce MVP

## Decision

The Marketplace buyer path is organization-scoped and is separate from runtime activation.

A package can be:

1. listed in the public Marketplace registry;
2. acquired by an organization through an entitlement;
3. paid for through an order when a paid plan is selected;
4. installed/activated by the existing package/runtime layers when an executable artifact exists.

This prevents the Marketplace from bypassing package security, permissions, approval, provenance or runtime lifecycle controls.

## Persistence

`MarketplaceCommerceStore` uses Node SQLite in the API runtime data directory.

It stores:

- organization-scoped entitlements;
- pending/paid/failed/cancelled orders;
- pricing model and plan identifiers;
- external payment references when a provider completes an order.

Free acquisition is idempotent. Paid plan acquisition creates a pending order and does **not** claim that payment succeeded.

## Payment boundary

Phase 2 deliberately does not execute a real payment.

The API returns `paymentProviderConfigured: false` for paid plans. A later payment adapter will:

- create provider checkout/prepay requests;
- verify provider callbacks/webhooks;
- call the store's order-completion path only after verified payment;
- issue or renew the entitlement;
- emit auditable billing events.

This keeps payment-provider selection replaceable and prevents provider-specific fields from entering the Marketplace core.

## Buyer UI

The main Marketplace screen now reads `/api/marketplace/v1` rather than treating the local package directory as the public store.

It supports:

- text search;
- package-type filters;
- category filters;
- pricing display;
- verified listing state;
- listing details;
- free acquisition;
- pending paid-order state;
- organization entitlement state.

The legacy platform package catalog remains responsible for locally available and runtime-manageable packages.

## Next boundaries

The next implementation layers are:

1. developer submission/review/version publishing into the registry;
2. signed artifact distribution and install bridge;
3. payment-provider adapter + verified webhook completion;
4. usage metering and revenue share ledger;
5. ratings/reviews and publisher analytics.
