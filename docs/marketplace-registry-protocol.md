# Hosted Marketplace Registry Protocol v1

## Purpose

OEAP already has an organization-local Marketplace for self-hosted Package development, validation, publishing and enablement. The hosted Marketplace is a separate concern: it provides public or private discovery metadata, publisher identity, commercial plan metadata and versioned artifact distribution for Packages that can later be imported into an OEAP installation.

The hosted registry must not become a second Package runtime. DeepSeek Harness remains an external AI runtime adapter, and every downloaded Package still enters OEAP through the local Package security, provenance, permission and approval boundaries.

## Contract boundary

Two contracts are intentionally separate.

### OEAP Package Manifest

`oeap.package.json` describes an installable technical artifact:

- Package id, type and version
- Entrypoint
- Capabilities
- Permissions
- Package dependencies
- Technical license identifier
- Runtime metadata

The Package Manifest 1.x contract remains unchanged by Marketplace commercial features.

### Marketplace Listing

A Marketplace Listing describes how a Package is discovered and commercially offered:

- Public listing id and slug
- Publisher profile
- Package type and latest version
- Search categories and tags
- Visibility and publication status
- Pricing plans
- Commercial license / entitlement metadata
- Install and rating aggregates
- Versioned artifact metadata

Pricing, ratings and publisher reputation must not be embedded into the Package Manifest. A Package can therefore move between registries without changing its installable technical contract.

## Package types

The registry uses the same OEAP Package types:

- `app`
- `agent`
- `skill`
- `workflow`
- `connector`
- `data-provider`

No industry-specific package type is added to platform core. Industry solutions are expressed through packages, tags, categories and workflows.

## Pricing metadata

Protocol v1 supports these pricing models:

- `free`
- `one-time`
- `subscription`
- `metered`
- `contact-sales`

Money amounts are represented as non-negative integers in the currency's minor unit (`amountMinor`) rather than floating point values. Paid plans require a three-letter uppercase currency code. Subscription plans require a billing interval. Metered plans require a unit name.

The protocol only describes commercial offers. It does **not** move money, grant entitlements or calculate developer revenue. Billing, entitlements, usage metering and settlement are separate services planned after the hosted registry service.

## Publisher profile

A public publisher profile can include:

- Stable publisher id
- Display name and description
- Website
- Support URL
- Privacy policy URL
- Terms URL
- Verification status

Publisher verification is registry metadata and must not be treated as permission to bypass local Package security checks. Self-service publisher writes cannot mark a publisher as verified; verification remains a registry-controlled state.

## Artifact integrity

Each published Package version is represented by a `MarketplaceArtifact` containing:

- `packageId`
- `version`
- `downloadUrl`
- `sha256`
- Package Manifest
- publication timestamp
- optional signature
- optional provenance URL
- optional changelog

SHA-256 content identity is required by the artifact contract. Registry policy may additionally require a signature or trusted publisher provenance.

Downloading an artifact must never automatically execute it. Import remains a local OEAP operation and must continue to apply the existing supply-chain checks, dependency validation, permission review and runtime activation rules.

## HTTP discovery surface

The public protocol uses a versioned registry namespace:

```text
GET /v1/listings
GET /v1/listings/:packageId
GET /v1/listings/:packageId/versions
GET /v1/listings/:packageId/versions/:version
GET /v1/publishers/:publisherId
```

`MarketplaceSearchRequest` supports:

- free-text query
- Package type
- publisher id
- pricing model
- tags
- categories
- cursor pagination

`MarketplaceSearchResponse` returns listing items plus an optional opaque `nextCursor`.

Public search returns only `published + public` listings. Direct public lookup can resolve `published + public/unlisted` listings. Draft and private listings are never exposed through the public surface.

## Publisher management surface

The first hosted-registry implementation runs inside the OEAP API deployment while keeping registry storage and contracts separate from the organization-local Package catalog. Management endpoints are organization-scoped and require OEAP package permissions:

```text
GET  /api/marketplace/registry
POST /api/marketplace/registry/publishers
PUT  /api/marketplace/registry/publishers/:publisherId
GET  /api/marketplace/registry/listings/:packageId
PUT  /api/marketplace/registry/listings/:packageId
POST /api/marketplace/registry/listings/:packageId/versions
POST /api/marketplace/registry/listings/:packageId/publish
POST /api/marketplace/registry/listings/:packageId/unpublish
```

Publisher ids are bound to the organization that creates them. A different organization cannot take over an existing publisher id or listing. Reads require `packages.read`; writes require `packages.manage`.

The storage implementation uses a dedicated registry SQLite database under `OEAP_DATA_DIR`. This is the initial durable backend and can later be replaced by the planned PostgreSQL enterprise backend without changing the protocol contract.

## Publication lifecycle

A self-service listing is written as `draft`. Publishing is a separate action and requires:

1. A valid Marketplace Listing.
2. A versioned artifact matching `latestVersion`.
3. A Package Manifest whose package id, package type and version match the listing/artifact.
4. A valid SHA-256 content digest.
5. Package Manifest compatibility validation.

Unpublishing returns the listing to `draft` and immediately removes it from the public discovery surface.

## Visibility and status

Visibility:

- `public` — discoverable through normal search
- `unlisted` — accessible by direct reference but excluded from normal discovery
- `private` — restricted to an entitled organization or private Marketplace

Listing status:

- `draft`
- `published`
- `suspended`
- `archived`

The current public API exposes only published public/unlisted records. Private entitlement delivery is intentionally deferred until the licensing/entitlement phase. Local OEAP Package permissions remain independent from Marketplace visibility.

## Security invariants

The hosted Marketplace must preserve these boundaries:

1. Registry metadata never grants runtime permissions.
2. Third-party Package code never receives direct database access.
3. Package import does not imply Package execution.
4. Side-effecting capabilities remain behind Action Gateway / Permission / Approval / Audit controls.
5. Package credentials are never stored in public listing metadata or package source.
6. Artifact integrity is verified before installation.
7. Commercial entitlement does not override organization security policy.
8. Publisher/listing ownership is organization-scoped and fails closed on cross-organization writes.
9. Self-service publisher/listing writes cannot self-assign verification or reputation values.

## Implementation phases

### Phase 1 — protocol foundation

Implemented:

- Marketplace Listing type
- Publisher Profile type
- Pricing Plan type
- Artifact type
- Search request/response type
- Route builders
- deterministic listing validation
- protocol regression test

### Phase 2 — hosted registry persistence and publication API

Implemented:

- dedicated durable registry storage
- organization-owned publisher records
- draft listing persistence
- versioned artifact metadata
- public discovery endpoints
- search filters and cursor pagination
- publish / unpublish lifecycle
- manifest compatibility and SHA-256 validation
- deterministic store regression test
- built API end-to-end registry test

The next scalability step is moving hosted registry storage/search to the production database/search infrastructure when traffic requires it; the v1 contract remains unchanged.

### Phase 3 — public Marketplace experience

Next:

- public publisher pages
- Package detail pages
- search/filter UI
- categories and discovery ranking

### Phase 4 — licensing and entitlements

- free/paid licenses
- organization entitlement records
- purchase/subscription lifecycle
- private Package access

### Phase 5 — billing and revenue sharing

- subscription billing
- metered usage records
- invoice ledger
- developer revenue ledger
- platform fees
- settlement reporting

### Phase 6 — trust and reputation

- reviews and ratings
- publisher reputation
- managed security-review program
- verified publisher / verified Package policies

## Why the registry is separate from DeepSeek Harness

DeepSeek Harness is one runtime adapter used by OEAP. Marketplace packages are OEAP business capabilities and should remain portable across future runtimes. Hosted Marketplace contracts therefore reference OEAP Package types and capabilities rather than DeepSeek-specific internals.
