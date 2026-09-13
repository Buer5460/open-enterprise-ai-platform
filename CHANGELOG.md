# Changelog

All notable changes to Open Enterprise AI Platform (OEAP) are documented here.

## 0.9.0 — Production Candidate

OEAP 0.9.0 is the first production-candidate release of the self-hosted platform. It closes the initial platform scope around AI application generation, enterprise tenancy, package extensibility, security, deployment, and operations.

### AI application lifecycle

- Natural-language enterprise application generation through a provider-independent AI capability and DeepSeek Harness adapter.
- Structured App Blueprints and installable App Packages.
- Generic SQLite-backed application runtime with CRUD, search and pagination.
- Rich generated fields including enum, currency, date/time, rich text, attachment, relation and JSON.
- AI-assisted revision of existing applications while preserving business data.
- Application version snapshots and rollback.
- Enterprise knowledge context is injected into application generation and revision.

### Enterprise platform

- Multi-organization tenancy with isolated applications, databases, Developer Studio assets and Marketplace packages.
- Owner, Admin, Manager, Member and Viewer roles plus custom roles.
- Per-member application access scopes and server-side RBAC enforcement.
- Persistent sessions and production-safe identity handling.
- GitHub, Google Workspace, Microsoft Entra ID and generic OIDC login providers.
- Invitation links/codes with expiry, revocation, single-use acceptance and session creation.
- Per-organization branding and mail configuration.
- Resend, SMTP, webhook and manual invitation delivery modes.

### Extensibility and package supply chain

- App, Agent, Skill, Workflow, Connector and Data Provider package types.
- Developer Studio scaffold, validation, local publishing and unpublishing.
- Marketplace and per-organization official Package enable/disable state.
- Encrypted Connector credential vault.
- GitHub Publisher using server-side credentials only.
- Ed25519 Package provenance, SHA-256 content digests and publisher fingerprints.
- Trusted GitHub Package import with static security scanning, provenance validation, trusted fingerprint checks and dependency validation.
- Remote package source is not automatically executed after import.
- TypeScript SDK and command-line client.

### Data, knowledge and operations

- File/attachment center with organization and application permission checks.
- Enterprise knowledge base and retrieval context.
- Runtime operation events, AI usage statistics and failure tracking.
- Approval request lifecycle with approve, reject and cancel operations.
- Tenancy and permission audit data.

### Deployment and security

- Production mode that rejects client-supplied identity spoofing and requires authenticated sessions.
- Brand-aware production login gate.
- Deployment/security readiness dashboard.
- `/health` liveness and `/ready` readiness endpoints.
- Docker multi-stage build, Docker Compose and Nginx reverse proxy.
- Production HTTP security headers and CSP.
- Persistent `OEAP_DATA_DIR` support.
- Backup and restore scripts.
- Static remote Package security scanner.
- Deterministic CI, container builds, Compose validation and automatic workspace lockfile synchronization.

### Release note

0.9.0 is a production candidate, not a claim that every external integration is preconfigured. Real deployments still require organization-owned secrets and infrastructure such as OAuth/OIDC credentials, mail credentials, public DNS/TLS and, when AI generation is required, a configured AI runtime/provider. Those credentials must remain outside source control.
