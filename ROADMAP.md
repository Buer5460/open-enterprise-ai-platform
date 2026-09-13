# OEAP Roadmap

OEAP has completed the initial platform scope and the repository-owned 1.0 compatibility/security-stabilization work. The current release line is **1.0.0-rc.2**: stable contracts, automated security gates, browser/API end-to-end tests, hardened backup/restore, Production Preflight and deployment artifacts are frozen for release-candidate evaluation. General Availability still requires an independent external security review and real deployment-owned infrastructure validation.

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
- [x] Correct fail-closed SemVer dependency-range evaluation
- [x] Remote import without automatic code execution

### Deployment and operations

- [x] Development/Production mode separation
- [x] Production Session identity boundary
- [x] Production Local Development login hard-disabled in code
- [x] HTTPS public URL requirements and fail-closed CORS policy
- [x] Docker multi-stage builds
- [x] Docker Compose deployment
- [x] Nginx reverse proxy and web security headers
- [x] Persistent runtime data directory
- [x] Hardened backup and restore with SHA-256/archive validation
- [x] Production Preflight offline/live validation
- [x] Repository runtime-state/secret hygiene gate
- [x] `/health` and `/ready`
- [x] Deterministic CI and container build validation
- [x] Built-API end-to-end test
- [x] Real Chrome browser end-to-end smoke test
- [x] Automatic pnpm lockfile synchronization
- [x] Tagged/controlled GitHub Release workflow

## 1.0 — Stable contracts

The 1.0 goal is compatibility and security stabilization rather than another large feature expansion.

- [x] Freeze Package Manifest 1.x compatibility rules
- [x] Freeze public TypeScript SDK APIs and add contract tests
- [x] Define migration guarantees for application Blueprints and persistent runtime data
- [x] Add compatibility fixtures for supported previous Package versions
- [x] Add API and real-browser end-to-end release gates
- [x] Document upgrade/rollback procedure between platform releases
- [x] Add release-version consistency checks for platform/API/Web/CLI/SDK/Package Spec
- [x] Harden OAuth state, verified external identity binding and production auth defaults
- [x] Harden remote Package provenance, static scan, path/size limits and SemVer dependency validation
- [x] Add backup/restore integrity and archive-traversal protections
- [x] Add repository credential/runtime-state leakage gate
- [x] Add Production Preflight configuration/live-deployment checker
- [x] Publish Threat Model and independent security-review checklist
- [x] Track the external GA security/deployment gate separately from source-code work
- [ ] Complete an independent external security review before declaring **1.0 General Availability**

### 1.0.0-rc.2 release criteria

- [x] Workspace build passes on Node.js 24 / pnpm 11.7.0
- [x] Deterministic regression suite passes
- [x] Repository hygiene scan passes
- [x] Production Preflight regression passes
- [x] Backup/restore integrity/traversal regression passes
- [x] Built API starts and passes critical session/RBAC/runtime probes
- [x] Headless Chrome renders and navigates core workspace pages without uncaught runtime exceptions
- [x] Docker Compose validates
- [x] API Docker image builds
- [x] Web Docker image builds
- [x] Production readiness fails closed when identity/public URL configuration is unsafe or incomplete
- [x] Release tags are required to match the platform SemVer version
- [x] RC releases publish as GitHub prereleases

## 1.0 GA deployment gates

These are environment/external-review requirements, not missing source-code features:

- [ ] Independent security review completed and material findings resolved
- [ ] Organization-owned OAuth/OIDC credentials configured and tested
- [ ] Production DNS/TLS and public HTTPS URLs configured
- [ ] Production mail provider credentials configured if automatic invitations are required
- [ ] Production backup/restore drill completed against the deployment data volume
- [ ] AI runtime/provider credentials configured and tested if AI generation is enabled

The authoritative GA tracker is GitHub issue #6.

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
