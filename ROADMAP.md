# OEAP Roadmap

OEAP has completed the initial platform foundation and repository-owned 1.0 compatibility/security stabilization work.

- **Stable independent-review baseline:** `1.0.0-rc.2`
- **Current development line:** `1.1.0-alpha.1`

1.0 General Availability still requires an independent external security review and real deployment-owned infrastructure validation. The 1.1 line does not redefine the 1.0 security baseline; it focuses on making the platform easier to start, operate and commercialize.

## 0.9 — Platform foundation

### Runtime and AI application lifecycle

- [x] Package specification and Package Manager
- [x] Capability registry and Connector runtime
- [x] Permission engine, approval engine, audit log and Action Gateway
- [x] Skill, Agent and Workflow runtimes
- [x] Provider-independent `ai.generate`
- [x] DeepSeek Harness adapter
- [x] AI application Blueprint generation
- [x] Blueprint → installable App Package
- [x] Generic SQLite generated-application runtime
- [x] CRUD, search and pagination
- [x] Rich enterprise field types
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
- [x] Invitation lifecycle
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
- [x] Fail-closed SemVer dependency-range evaluation
- [x] Remote import without automatic code execution

### Deployment and operations

- [x] Development/Production mode separation
- [x] Production Session identity boundary
- [x] Production Local Development login hard-disabled
- [x] HTTPS public URL requirements and fail-closed CORS
- [x] Docker multi-stage builds
- [x] Docker Compose deployment
- [x] Nginx reverse proxy and Web security headers
- [x] Persistent `OEAP_DATA_DIR`
- [x] Hardened backup and restore
- [x] Production Preflight offline/live validation
- [x] Repository runtime-state/secret hygiene gate
- [x] `/health` and `/ready`
- [x] Deterministic CI and container validation
- [x] Built-API E2E
- [x] Real Chrome browser E2E
- [x] Automatic pnpm lockfile synchronization
- [x] Controlled GitHub Release workflow

## 1.0 — Stable contracts and security baseline

- [x] Freeze Package Manifest 1.x compatibility rules
- [x] Freeze public TypeScript SDK APIs and add contract tests
- [x] Define migration guarantees for application Blueprints and persistent runtime data
- [x] Add compatibility fixtures for supported previous Package versions
- [x] Add API and real-browser release gates
- [x] Document platform upgrade/rollback
- [x] Add release-version consistency checks
- [x] Harden OAuth state and external identity binding
- [x] Harden remote Package provenance/path/size/dependency validation
- [x] Add backup/restore integrity and traversal protections
- [x] Add repository credential/runtime-state leakage gate
- [x] Add Production Preflight configuration/live checker
- [x] Publish Threat Model and independent security-review checklist
- [x] Track external GA security/deployment gates separately
- [ ] Complete independent external security review before declaring **1.0 General Availability**

### 1.0 GA deployment gates

These are environment/external-review requirements, not missing source-code features:

- [ ] Independent security review completed and material findings resolved
- [ ] Organization-owned OAuth/OIDC credentials configured and tested
- [ ] Production DNS/TLS and public HTTPS URLs configured
- [ ] Production mail credentials configured when required
- [ ] Production backup/restore drill completed
- [ ] AI provider credentials configured and tested when AI is enabled

The authoritative GA tracker remains GitHub issue #6.

## 1.1 — Day-1 usability and commercial ecosystem

### Business users can start without AI

- [x] CRM Day-1 template
- [x] Travel-agency management template
- [x] Payment-service ERP template
- [x] Project/task collaboration template
- [x] One-click template application creation
- [x] Business-data overview
- [x] CSV / JSON import and export
- [x] Dry-run data migration validation
- [x] Transactional batch import
- [x] Server-side CRUD field validation
- [x] CSV formula-injection hardening
- [x] Application archive and restore without deleting business data

### Daily workspace

- [x] Application search
- [x] Member favorites
- [x] Recently used applications
- [x] Server-side member preference persistence
- [x] Member-scoped personal application folders/categories
- [x] Smart / recent / name / folder sorting
- [x] Legacy app-preference schema migration

### AI Runtime becomes provider-flexible

- [x] DeepSeek Harness Provider
- [x] OpenAI-Compatible Provider
- [x] `auto / deepseek-harness / openai-compatible` selection
- [x] Organization-level encrypted AI API configuration
- [x] Provider configuration UI
- [x] Real AI runtime test endpoint
- [x] Compatible-provider mock E2E
- [x] App Builder organization/provider context propagation
- [x] Production Preflight multi-provider validation

### Marketplace ecosystem

- [x] Marketplace Registry protocol
- [x] Runtime Registry foundation
- [x] Public discovery/read APIs
- [x] Official seeded listings
- [x] Buyer-facing Marketplace UI
- [x] Organization-scoped free acquisition
- [x] Organization-scoped entitlement store
- [x] Order model and buyer order history foundation
- [ ] Third-party paid checkout Connector
- [ ] Signed server-to-server payment webhook verification
- [ ] Subscription renewal/cancellation lifecycle
- [ ] Metered usage billing
- [ ] Revenue sharing and publisher settlement
- [ ] Ratings/reviews and publisher reputation
- [ ] Managed Marketplace security-review program

### 1.1.0-alpha.1 release criteria

- [x] Package/API/Web development version moved to 1.1 alpha line
- [x] Day-1 no-AI application path is covered by API and browser E2E
- [x] CSV/JSON migration path is covered by deterministic/API tests
- [x] OpenAI-Compatible Provider is covered without external secrets
- [x] Application archive/restore has deterministic regression coverage
- [x] App preference member isolation has deterministic coverage
- [x] Marketplace registry/acquisition tests are deterministic
- [x] 5-minute first-use documentation exists
- [ ] Final alpha full CI is green on release commit
- [ ] `v1.1.0-alpha.1` GitHub prerelease published

## Post-1.1 — Scalable enterprise infrastructure

- [ ] PostgreSQL enterprise data backend
- [ ] Object-storage backend for large files
- [ ] Pluggable vector database / embedding providers
- [ ] Queue/worker execution mode for long-running workflows
- [ ] Horizontal API scaling and distributed runtime state
- [ ] OpenTelemetry metrics/traces
- [ ] Enterprise secret-manager adapters (Vault/KMS/cloud secret managers)
- [ ] SCIM provisioning
- [ ] Fine-grained row/field data policies

## Visual builders

OEAP ultimately supports three creation paths over the same Package model:

1. Natural-language AI App Builder — implemented
2. Visual application/workflow builder — future
3. Developer SDK/source code — implemented

Future visual tooling should generate the same Blueprint and Package contracts rather than creating a second runtime model.

## Official Package families

Candidate official/community families remain outside hard-coded OEAP core:

- Software development
- Growth/sales and lead generation
- Business analysis
- Investment research
- Payments/payment-service ERP
- Cross-border payments
- Travel/tourism
- Transportation
- Retail and international trade
- Legal operations, HR and customer service

The platform should remain runtime/provider agnostic where practical, with AI providers and enterprise services connected through standard capabilities and Connectors.
