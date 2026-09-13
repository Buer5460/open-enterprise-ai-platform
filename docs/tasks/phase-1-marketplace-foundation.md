# DeepSeek Harness Task: Phase 1 Marketplace Foundation

## Objective

Implement the first functional marketplace foundation in this repository without changing DeepSeek Harness source code and without creating a parallel plugin system.

Follow `AGENTS.md` strictly.

## Existing architecture to reuse

Before writing code, inspect these packages and reuse their current contracts and behavior:

- `packages/package-spec`
- `packages/package-manager`
- `packages/permission-engine`
- `packages/approval-engine`
- `packages/audit-log`
- `packages/capability-registry`
- `packages/data-runtime`
- `packages/action-gateway`
- `packages/harness-adapter`

Do not duplicate responsibilities already implemented there.

## Deliverable A — Marketplace registry service

Create a new workspace package:

`packages/marketplace-registry`

Responsibilities:

- store and retrieve marketplace publisher profiles;
- store and retrieve marketplace listings;
- store and retrieve package artifacts / versions;
- validate listing data using `@oeap/package-spec`;
- search listings by query, type, pricing model, category and tags;
- expose a storage interface so persistence can be replaced later;
- ship with an in-memory implementation for V1 tests.

Required public API shape:

```ts
export interface MarketplaceRegistry {
  upsertPublisher(profile: MarketplacePublisherProfile): Promise<void>;
  getPublisher(id: string): Promise<MarketplacePublisherProfile | null>;

  upsertListing(listing: MarketplaceListing): Promise<void>;
  getListing(packageId: string): Promise<MarketplaceListing | null>;
  search(request: MarketplaceSearchRequest): Promise<MarketplaceSearchResponse>;

  publishArtifact(artifact: MarketplaceArtifact): Promise<void>;
  getArtifact(packageId: string, version: string): Promise<MarketplaceArtifact | null>;
  listVersions(packageId: string): Promise<MarketplaceArtifact[]>;
}
```

Do not add a database dependency in this task.

## Deliverable B — Registry HTTP routes

Add API routes under:

`/api/marketplace/v1`

Minimum endpoints:

- `GET /listings`
- `GET /listings/:packageId`
- `GET /listings/:packageId/versions`
- `GET /listings/:packageId/versions/:version`
- `GET /publishers/:publisherId`

For this task, read-only public marketplace routes are enough. Publishing/admin mutation routes are deferred.

Use the route constants already defined in `@oeap/package-spec` where practical.

## Deliverable C — Seed official listings

Create V1 seed listings for five official packages:

1. `company-research`
2. `lead-generation`
3. `opportunity-radar`
4. `business-analysis`
5. `investment-analysis`

These are marketplace metadata entries only. Do not fake full implementations if the corresponding packages do not exist yet.

Each listing must include:

- packageId
- packageType
- slug
- displayName
- summary
- publisherId = `oeap-official`
- version
- categories
- tags
- pricing plan
- license
- visibility
- status

Use `free` pricing for the initial seed listings.

## Deliverable D — Marketplace validation tests

Add automated tests covering at least:

- valid listing accepted;
- invalid slug rejected;
- duplicate pricing plan IDs rejected;
- subscription plan without interval rejected;
- paid plan without currency rejected;
- invalid rating rejected;
- search by type;
- search by category;
- search by pricing model;
- artifact lookup by version;
- unknown package returns null / 404 as appropriate.

Do not change unrelated tests.

## Deliverable E — Architecture report

At completion, report exactly:

1. changed files;
2. purpose of each change;
3. tests run and result;
4. API endpoints added;
5. known risks;
6. next recommended task.

## Engineering constraints

- TypeScript only.
- Avoid new runtime dependencies unless essential.
- No secrets.
- No direct third-party database access.
- No direct DeepSeek Harness internal imports.
- Do not implement billing settlement yet.
- Do not implement public publisher write APIs yet.
- Do not refactor unrelated modules.
- Preserve all existing behavior.

## Definition of done

The task is done only when:

- `pnpm -r build` passes;
- relevant tests pass;
- marketplace read APIs work against seeded in-memory data;
- no direct Harness coupling is introduced;
- no unrelated functionality is modified.
