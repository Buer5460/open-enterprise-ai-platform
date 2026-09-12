# OEAP Architecture

Open Enterprise AI Platform (OEAP) is designed as an open application platform rather than a single enterprise SaaS product.

## Core principle

Industry-specific business logic should live in packages. The platform core should provide execution, data, permissions, packaging and developer infrastructure.

## High-level stack

```text
User / Enterprise Team
        │
        ▼
AI App Builder / Web Platform
        │
        ▼
App / Agent / Workflow Runtime
        │
        ▼
Skill Runtime
        │
        ▼
Capability Registry
        │
        ▼
Action Gateway
  ┌─────┼─────────┐
  ▼     ▼         ▼
Permission Approval Audit
        │
        ▼
Connector Runtime / MCP
        │
        ▼
External Systems / Data / AI Runtimes
```

DeepSeek Harness is currently used through an adapter and connector. It is intentionally not hard-coded into the platform core.

## Package types

OEAP defines six top-level package types:

- `app`
- `agent`
- `skill`
- `workflow`
- `connector`
- `data-provider`

Packages can be installed, enabled, disabled and eventually distributed through registries or a Marketplace.

## Capability abstraction

Skills depend on capabilities rather than vendors.

Example:

```text
Growth Agent
   ↓
social-first-touch Skill
   ↓
social.like / social.follow / social.dm
   ↓
Capability Registry
   ↓
Connector A / Connector B / MCP server
```

This keeps Skills portable when vendors or APIs change.

## Side-effect boundary

External actions should pass through the Action Gateway:

```text
Request
  ↓
Permission Engine
  ├─ deny
  ├─ require approval
  └─ allow
       ↓
Connector Runtime
       ↓
Audit Log
```

This boundary is especially important for social outreach, email, deployments, payments and trading.

## App generation

The current App Builder flow is:

```text
Natural-language business requirement
  ↓
AI App Builder
  ↓
App Blueprint
  ├─ roles
  ├─ entities
  ├─ pages
  ├─ workflows
  └─ recommended packages
  ↓
App Package Builder
  ↓
Installable OEAP App Package
  ↓
Dynamic App Runtime
```

Generated apps currently use a local SQLite-backed dynamic data runtime for early development. The storage layer is expected to become pluggable.

## Repository layout

- `apps/` — platform API and web surfaces
- `packages/` — platform runtime and package modules
- `packages/official/` — official example packages
- `scripts/` — local development and integration tests
- `docs/` — architecture and package authoring documentation

## Long-term direction

OEAP aims to support:

- AI-assisted enterprise application creation
- Natural-language modification of existing apps
- Third-party package development
- Developer Studio
- Open package specifications
- Local and hosted registries
- Optional Marketplace services
- Multiple AI runtimes and model providers
