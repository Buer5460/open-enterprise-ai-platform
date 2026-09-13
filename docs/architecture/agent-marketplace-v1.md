# Agent Marketplace V1 Architecture

## Goal

Evolve Open Enterprise AI Platform into a commercial Agent Marketplace while keeping DeepSeek Harness as an external runtime adapter rather than coupling business logic to Harness internals.

The platform must support five commercial product forms:

1. Skill
2. Tool / Connector
3. Data Provider
4. Agent
5. Workflow

Existing OEAP package types remain the canonical installable unit. Marketplace is a commercial distribution layer on top of those package types.

## Architectural decision

Do **not** build a second plugin system.

Reuse and extend the existing modules already present in this repository:

- `packages/package-spec` — package / marketplace contracts
- `packages/package-manager` — install, enable, disable, dependency handling
- `packages/permission-engine` — permission checks
- `packages/approval-engine` — human approval for high-risk actions
- `packages/audit-log` — audit trail
- `packages/harness-adapter` — DeepSeek Harness adapter boundary
- `packages/capability-registry` — capability discovery
- `packages/data-runtime` — controlled data access
- `packages/action-gateway` — auditable side effects

The new work should add marketplace domain functionality around this foundation instead of replacing it.

## V1 layers

```text
Marketplace UI
    |
Marketplace API / Registry
    |
Entitlement + Billing Boundary
    |
Package Manager
    |
Permission / Approval / Audit
    |
Package Runtime / Capability Registry
    |
Harness Adapter
    |
DeepSeek Harness
```

## V1 scope

### Marketplace registry

Support:

- publisher profiles
- marketplace listings
- package versions
- pricing plans
- visibility and publication status
- categories and tags
- install count and rating summary
- artifact metadata
- compatibility metadata

### Plugin standard

The existing `OEAPBaseManifest` remains the canonical base manifest.

Every public package must expose:

- explicit type
- semantic version
- publisher
- description
- entry point when executable
- permissions
- capabilities
- dependencies
- input/output contract at the package-specific level
- runtime compatibility where applicable

Commercial metadata must **not** be required inside the package manifest. Pricing, listing status, reviews and sales metadata belong to the marketplace registry.

### Security boundary

Third-party packages must never receive direct database access.

All access must use platform-controlled gateways:

- data access through Data Runtime
- external side effects through Action Gateway
- permissions through Permission Engine
- high-risk actions through Approval Engine
- all side effects written to Audit Log

High-risk examples:

- sending email or messages
- writing CRM records
- modifying databases
- deleting files
- performing payment-related actions
- publishing external content

### DeepSeek Harness boundary

DeepSeek Harness remains replaceable.

No marketplace code may depend directly on DeepSeek Harness internal APIs. All runtime interaction must pass through `packages/harness-adapter` or a future runtime adapter interface.

## First official products

The first commercial-quality packages should be:

1. Company Research
2. Lead Generation
3. Opportunity Radar
4. Business Analysis
5. Investment Analysis

The first reference workflow is `B2B Lead Generation`:

```text
ICP Builder
  -> Company Search
  -> Company Research
  -> Contact Discovery
  -> Lead Scoring
  -> Outreach Draft
  -> Human Approval
  -> Send
  -> CRM Writeback
```

The second reference workflow is `Opportunity Radar`:

```text
Research Sources
  -> Event Normalization
  -> Deduplication
  -> Opportunity Detection
  -> Opportunity Scoring
  -> Business Analysis
  -> Recommended Actions
```

## Phase 1 acceptance criteria

Phase 1 is complete when:

1. marketplace contracts have automated tests;
2. a registry service can list, retrieve and validate marketplace listings;
3. a package can be installed from a registry artifact through the existing package manager;
4. install-time permissions are visible before activation;
5. enable / disable state is persisted;
6. execution is blocked when required permissions are not granted;
7. high-risk actions can require approval;
8. all marketplace package executions produce audit records;
9. DeepSeek Harness interaction remains behind the adapter boundary;
10. at least one official Skill and one official Workflow run end-to-end.

## Explicit non-goals for Phase 1

Do not implement yet:

- multi-runtime support beyond the adapter abstraction
- public developer payouts
- automated financial settlement
- hundreds of official packages
- blockchain settlement
- token economy
- social feed
- complex recommendation algorithms

## Commercial direction

Marketplace commercialization will later add:

- free plans
- one-time purchase
- subscription
- metered usage
- enterprise private marketplace
- publisher verification
- usage metering
- entitlement checks
- revenue share

The implementation order is:

`standard -> registry -> install -> permissions -> workflow -> official packages -> marketplace UI -> billing`.
