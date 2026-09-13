# OEAP Roadmap

OEAP 0.9.0 is the first production-candidate milestone. This roadmap separates the completed initial platform scope from work intentionally left for later releases.

## 0.9 — Platform foundation and production candidate

### Runtime and AI application lifecycle

- [x] Package specification and Package Manager
- [x] Capability registry and Connector runtime
- [x] Permission engine, approval engine, audit log and Action Gateway
- [x] Skill, Agent and Workflow runtimes
- [x] DeepSeek Harness adapter and provider-independent `ai.generate`
- [x] AI application Blueprint generation
- [x] Blueprint → installable App Package
- [x] Generic SQLite generated-application runtime
- [x] CRUD, search and pagination
- [x] Enum, date/time, currency, relation, attachment, rich-text and JSON fields
- [x] AI-assisted application revision
- [x] Schema evolution and application version snapshots
- [x] Application rollback
- [x] Enterprise knowledge injection for App Builder and Agent execution context

### Enterprise workspace

- [x] Multi-organization tenancy
- [x] Session authentication
- [x] GitHub / Google / Microsoft / OIDC login providers
- [x] Owner/Admin/Manager/Member/Viewer and custom roles
- [x] Server-side RBAC and app access scopes
- [x] Organization-isolated app databases
- [x] Organization-isolated Developer Studio / Marketplace assets
- [x] Invitation links/codes, expiry, revoke and single-use acceptance
- [x] Organization branding and production login page
- [x] SMTP / Resend / webhook / manual mail delivery
- [x] Enterprise knowledge base
- [x] File/attachment center
- [x] Operations/run history and failure statistics
- [x] Approval center
- [x] Encrypted Connector secret vault
- [x] Deployment/security readiness center

### Developer ecosystem and supply chain

- [x] Developer Studio scaffolding
- [x] App / Agent / Skill / Workflow / Connector / Data Provider package types
- [x] Package structural validation and smoke tests
- [x] Organization-local Marketplace
- [x] TypeScript SDK
- [x] OEAP CLI
- [x] GitHub Publisher
- [x] Ed25519 provenance and SHA-256 content digests
- [x] Trusted GitHub Package import
- [x] Static Package security scan
- [x] Trusted publisher fingerprints
- [x] Package dependency validation
- [x] Remote import without automatic code execution

### Deployment and operations

- [x] Development/Production mode separation
- [x] Production Session identity boundary
- [x] Docker multi-stage builds
- [x] Docker Compose deployment
- [x] Nginx reverse proxy and web security headers
- [x] Persistent runtime data directory
- [x] Backup and restore scripts
- [x] `/health` and `/ready`
- [x] Deterministic CI and container build validation
- [x] Automatic pnpm lockfile synchronization
- [x] Tagged GitHub Release workflow

## 1.0 — Stable contracts

The 1.0 goal is compatibility stabilization rather than another large feature expansion.

- [ ] Freeze Package Manifest 1.x compatibility rules
- [ ] Freeze public TypeScript SDK APIs
- [ ] Define migration guarantees for application Blueprints and persistent runtime data
- [ ] Add compatibility fixtures for supported previous Package versions
- [ ] Expand end-to-end browser tests
- [ ] Add documented upgrade/rollback procedure between platform releases
- [ ] Complete external security review before declaring general availability

## Post-1.0 — Scalable enterprise infrastructure

- [ ] PostgreSQL enterprise data backend
- [ ] Object-storage backend for large files
- [ ] Pluggable vector database / embedding providers
- [ ] Queue/worker execution mode for long-running workflows
- [ ] Horizontal API scaling and distributed runtime state
- [ ] OpenTelemetry metrics/traces
- [ ] Enterprise secret-manager adapters (Vault/KMS/cloud secret managers)
- [ ] SCIM provisioning
- [ ] Fine-grained row/field data policies

## Marketplace ecosystem

- [ ] Hosted Package registry protocol
- [ ] Public publisher profiles and package pages
- [ ] Registry search/discovery API
- [ ] Ratings/reviews and publisher reputation
- [ ] Free/paid Package licensing
- [ ] Subscription and metered pricing
- [ ] Revenue sharing
- [ ] Managed security-review program

## Visual builders

OEAP ultimately supports three creation paths over the same Package model:

1. Natural-language AI App Builder — implemented
2. Visual application/workflow builder — future
3. Developer SDK/source code — implemented

Future visual tooling should generate the same Blueprint and Package contracts rather than creating a second runtime model.

## Official Package families

Candidate official/community families remain outside hard-coded OEAP core:

- Software development: PRD, architecture, coding, review, GitHub and deployment workflows
- Growth/sales: lead generation, scoring, outreach, CRM and growth agents
- Business analysis: company research, competition, operating metrics and business agents
- Investment research: filings, financial analysis, valuation, risk and investment memos
- Payments/payment-service ERP
- Cross-border payments
- Travel/tourism
- Transportation
- Retail and international trade
- Legal operations, HR and customer service

The platform should remain runtime/provider agnostic where practical, with AI providers and enterprise services connected through standard capabilities and Connectors.
