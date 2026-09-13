# Changelog

All notable changes to Open Enterprise AI Platform (OEAP) are documented here.

## 1.0.0-rc.2 — Backup and Deployment Hardening Release Candidate

OEAP 1.0.0-rc.2 keeps the stable 1.x Package/SDK contracts from rc.1 and adds a focused post-RC security/reliability hardening pass. It does not expand the platform feature surface.

### Backup and restore hardening

- Filesystem backups now refuse to run while the local OEAP API health endpoint is reachable, reducing the risk of inconsistent SQLite copies.
- Backup targets inside `OEAP_DATA_DIR` and filesystem-root runtime directories are rejected.
- Backup creation rejects symlinks and special/device/socket/FIFO entries.
- Every new backup receives a SHA-256 sidecar for integrity verification.
- Restore verifies the SHA-256 sidecar when present and remains compatible with trusted legacy archives that do not have one.
- Restore validates archive paths before modifying runtime data and rejects absolute paths and `..` traversal entries.
- Restore rejects symbolic links, hard links and special/device entries.
- Restore extracts into a staging directory first, re-validates the staged tree and creates a pre-restore safety copy before switching data.
- CI performs a real backup → mutation → restore test, checksum-tamper rejection and a GNU-tar path-traversal regression test.

### Repository and secret hygiene

- CI now scans tracked files and rejects runtime-state/secrets such as `.env`, SQLite databases, encrypted local stores, private-key files and backup archives.
- High-confidence credential patterns for private keys, GitHub/AWS/Google/Slack/Stripe/Resend and generic provider keys are rejected from tracked source.
- `.gitignore` was hardened for credentials, runtime databases, encrypted state, backups and local IDE state.

### Production deployment preflight

- Added `pnpm preflight:production -- --env-file .env` for offline Production configuration checks.
- Added `--live` mode to validate the deployed Web endpoint, `/health`, `/ready`, TLS reachability and key Web security headers.
- Preflight checks Production mode, Local Auth safety, external OAuth/OIDC availability, HTTPS public URLs, CORS semantics, Session TTL and persistent data directory safety.
- Preflight reports whether mail/AI runtime configuration is present without printing secret values.
- Configuration and secret-redaction behavior are regression-tested in CI.

### Security review package

- Added `docs/threat-model.md` covering assets, trust boundaries, threat scenarios, mitigations, release-blocking invariants and residual risks.
- Added `docs/security-review-checklist.md` with an executable independent-review/penetration-test checklist and severity guide.
- `SECURITY.md`, Production checklist and release-readiness guidance were aligned with the 1.0 RC security boundary.
- GitHub issue #6 tracks the independent security review and deployment-owned GA validation separately from repository feature work.

### Release boundary

`1.0.0-rc.2` is the recommended 1.0 release-candidate baseline for independent review and controlled self-hosted evaluation. Repository-owned 1.0 engineering is complete at this RC baseline, but `1.0.0` General Availability still requires an independent external security assessment and real deployment validation of OAuth/OIDC, DNS/TLS, backup/restore, and any required mail/AI provider infrastructure.

## 1.0.0-rc.1 — Stable Contract Release Candidate

OEAP 1.0.0-rc.1 freezes the first stable Package/SDK contracts and closes the internal engineering work required for a 1.0 release candidate. It is intended for controlled self-hosted evaluation before 1.0 General Availability.

### Compatibility and release contracts

- Package Manifest `1.x` compatibility rules are explicit and covered by fixtures/regression tests.
- Public TypeScript SDK 1.x method contract is frozen and continuously tested.
- Platform, API, Web, CLI, SDK and Package Spec release versions are required to match.
- Git tags must match the repository SemVer version before Release publishing.
- Release-candidate tags are automatically marked as GitHub prereleases.
- Application Blueprint/runtime migration guarantees and platform upgrade/rollback procedures are documented.

### Authentication and production hardening

- Production Local Development login is hard-disabled in code even if an unsafe environment override attempts to enable it.
- Production ignores client-selected organization/member identity and requires authenticated Session identity.
- Existing SSO identities resolve through stable provider-subject bindings before email lookup; email is used only for first binding.
- A stale/disabled external identity binding fails closed instead of silently rebinding by email.
- GitHub first-login enterprise matching requires an address returned by GitHub as verified.
- OAuth state/PKCE state uses the configured runtime data root.
- Production public Web/API URLs must be valid HTTPS URLs.
- Production CORS is fail-closed: wildcard origins are rejected; cross-origin deployments require explicit trusted HTTPS origins.
- `/ready` is a public infrastructure probe while still failing when required production identity/public URL configuration is unsafe or incomplete.

### Package supply-chain hardening

- Remote GitHub Package import continues to require static scanning, trusted Ed25519 provenance and publisher fingerprint validation.
- Remote imports reject symlinks/submodules and enforce file-count/per-file/aggregate size bounds.
- Package dependency evaluation now uses a fail-closed SemVer range evaluator.
- Correct zero-major caret semantics are enforced (`^0.2.0` does not accept `0.9.0`, `^0.0.3` does not accept `0.0.4`).
- Exact, wildcard, caret, tilde, comparator, AND/OR and prerelease range behavior is regression-tested.

### Runtime persistence and deployment

- Core Session, tenancy, OAuth flow, branding, mail, file, operations, invitation, knowledge and Package assets consistently honor `OEAP_DATA_DIR`.
- Deployment readiness checks use the same runtime data root as the actual stores.
- Built API end-to-end tests verify that critical state is persisted under a custom runtime data directory.
- `/health` reports the repository platform version; `/ready` validates runtime data writability and production configuration.

### End-to-end quality gates

The CI release gate now includes:

- frozen-lockfile install
- full workspace TypeScript/Vite build
- deterministic runtime/RBAC/auth/invitation/mail/supply-chain/multi-tenant tests
- Package compatibility and SemVer dependency tests
- SDK 1.x contract tests
- built API end-to-end test
- real headless Chrome rendering/navigation of the enterprise workspace
- uncaught browser runtime-exception detection
- shell-script validation
- Docker Compose validation
- API Docker image build
- Web Docker image build

### GA boundary

1.0.0-rc.1 does **not** self-certify an independent security review or external production services. 1.0 General Availability still requires an independent security review plus deployment-owned OAuth/OIDC credentials, production DNS/TLS, backup/restore validation, mail credentials when automatic mail is used, and a configured AI runtime/provider when AI generation is enabled.

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
