# OEAP 1.0 Threat Model

This document defines the security model for Open Enterprise AI Platform (OEAP) 1.0 release-candidate deployments. It is intended for maintainers, deployment owners and independent reviewers. It does not replace an external security assessment.

## 1. Assets to protect

Critical assets include:

- Enterprise identities, Session tokens and OAuth/OIDC bindings.
- Organization membership, roles, permissions and application-access scopes.
- Application business data and generated application schemas.
- Enterprise files, attachments and knowledge-base content.
- Connector credentials, mail credentials, signing keys and OAuth client secrets.
- Developer Studio source, Marketplace Packages and Package provenance/signatures.
- Audit/operations history and approval decisions.
- AI prompts, retrieved enterprise context and AI-generated application definitions.
- Backup archives and the persistent `OEAP_DATA_DIR` volume.

## 2. Primary trust boundaries

### Browser ↔ OEAP Web/API

The browser is untrusted for identity selection. Production identity comes only from a server-side Session. Client-supplied organization/member headers are ignored in Production.

Security controls:

- HTTPS required for production public URLs.
- Strict CORS policy; wildcard production origins are rejected.
- Session Bearer tokens are validated server-side.
- Nginx/Web CSP and standard browser security headers.
- Request body-size bounds.

### OEAP API ↔ Identity Provider

GitHub, Google Workspace, Microsoft Entra ID and generic OIDC providers are external trust dependencies.

Security controls:

- OAuth state is random, single-use and time-limited.
- PKCE is used for supported OIDC flows.
- OIDC endpoints must use HTTPS except explicit localhost development.
- Existing identities use stable provider-subject bindings.
- First binding uses organization membership/email matching; GitHub requires a verified email.
- External identities cannot silently rebind to a different OEAP member.

### Organization A ↔ Organization B

Tenant isolation is a hard security boundary.

Security controls:

- Session establishes organization/member identity.
- Server-side RBAC and app-access scopes.
- Organization-isolated application databases.
- Organization-isolated Developer Studio/Marketplace assets.
- Organization-scoped files, knowledge, operations and Connector secrets.
- Multi-tenant regression tests run in CI.

### OEAP Core ↔ Package/Connector Code

Package source and Connector integrations are a software supply-chain boundary and may be hostile.

Security controls:

- Remote Packages are downloaded into staging storage.
- Symlink/submodule entries are rejected.
- File-count, per-file and aggregate-size limits are enforced.
- Static Package security scanning runs before import.
- SHA-256 content digests and Ed25519 provenance are verified.
- Publisher fingerprints must be explicitly trusted.
- Dependency ranges are fail-closed.
- Remote import does not automatically execute source code.
- Runtime activation remains explicit.

Important limitation: OEAP does not currently provide a full OS/container sandbox for arbitrary third-party Package execution. Only reviewed and trusted Packages should be activated.

### OEAP API ↔ Persistent Storage

`OEAP_DATA_DIR` contains high-value runtime state and must be treated as sensitive server storage.

Security controls:

- Runtime paths are centralized under the configured persistent root.
- Sensitive local settings are encrypted with local keys.
- File/object paths are normalized/sanitized.
- Backup/restore tooling operates on the runtime root.
- Production deployment must protect filesystem/volume access independently of OEAP.

### OEAP ↔ AI Runtime / External Connectors

AI providers, DeepSeek Harness, SaaS APIs, MCP servers and enterprise systems may receive organization data or cause side effects.

Security controls:

- Capabilities are resolved through Connectors/runtime abstractions.
- Permission Engine, Approval Engine and Action Gateway mediate controlled actions.
- Connector credentials remain outside Package source.
- Enterprise knowledge injection is organization-scoped.
- Live provider calls are intentionally excluded from public CI because credentials/infrastructure are deployment-owned.

## 3. Threat scenarios and mitigations

### T1 — Client identity spoofing

**Threat:** attacker sends `x-oeap-org` / `x-oeap-member` headers to impersonate another user.

**Mitigation:** Production overwrites untrusted identity headers and derives identity only from a valid Session. Protected APIs reject unauthenticated requests.

### T2 — Session theft

**Threat:** stolen Bearer token grants temporary access.

**Mitigation:** bounded Session lifetime, logout/revocation support, disabled-member checks, HTTPS requirement and no Session token in persistent browser URLs after redirect processing.

**Residual risk:** bearer tokens remain valuable while valid. Deployment should add endpoint/device/session telemetry and upstream controls where required.

### T3 — OAuth login CSRF/replay

**Threat:** attacker replays or substitutes OAuth callbacks.

**Mitigation:** random one-time state, expiration, provider binding and PKCE where supported.

### T4 — Account takeover through email recycling/change

**Threat:** an external account changes email and is accidentally mapped to another enterprise member.

**Mitigation:** after first successful binding, provider subject is authoritative. Existing bindings fail closed if the bound enterprise member no longer exists/is active; they are not silently rematched by email.

### T5 — Cross-tenant data access

**Threat:** member of one organization reads/writes another organization's business data or Package assets.

**Mitigation:** server-side organization identity, RBAC/app scopes, tenant-scoped database/file/knowledge/Package paths and multi-tenant regression tests.

### T6 — Malicious remote Package

**Threat:** imported Package contains credential theft, unsafe code or dependency tricks.

**Mitigation:** provenance verification, trusted fingerprint, static scan, file/path restrictions, dependency validation and no automatic execution after import.

**Residual risk:** static scanning cannot prove arbitrary code safe. Human review/sandboxing is required for high-risk or unknown Packages.

### T7 — Package downgrade/dependency confusion

**Threat:** Package claims a dependency range that resolves to an incompatible or attacker-controlled version.

**Mitigation:** explicit Package IDs, fail-closed SemVer range evaluation and organization-local/official dependency inventory checks.

### T8 — Secret exfiltration

**Threat:** Package source, UI or logs expose API keys/passwords/private keys.

**Mitigation:** encrypted Connector vault, deployment environment secrets, no browser secret echo, Package scanner rejects credential/private-key style files, security policy prohibits committed secrets.

### T9 — File path traversal / storage overwrite

**Threat:** crafted filename/path escapes the runtime root.

**Mitigation:** generated opaque file IDs, sanitized display names/extensions and controlled organization-scoped storage paths.

### T10 — AI prompt/context data leakage

**Threat:** enterprise knowledge is sent to an unintended AI provider or another tenant.

**Mitigation:** tenant-scoped knowledge retrieval, capability-based provider integration and deployment-controlled provider configuration.

**Residual risk:** the selected external AI provider may receive sensitive content. Deployment owner must select providers and retention settings appropriate for the data classification.

### T11 — Unsafe AI-generated application changes

**Threat:** AI revision damages application schema/behavior.

**Mitigation:** application version snapshots, migration handling and rollback support. High-risk actions should use approval boundaries.

### T12 — Backup compromise

**Threat:** backup archive exposes business data, credentials or signing material.

**Mitigation:** backups are treated as sensitive infrastructure assets; storage encryption/access control and off-host lifecycle are deployment responsibilities. Restore drills are a production requirement.

### T13 — Denial of service / resource exhaustion

**Threat:** oversized requests, files or Package imports exhaust memory/disk/network.

**Mitigation:** API body limit, file limits, remote Package file/count/aggregate limits and reverse-proxy deployment boundary.

**Residual risk:** distributed rate limiting/queues/horizontal isolation are post-1.0 infrastructure work.

### T14 — Approval bypass

**Threat:** side-effecting operation is executed without required human approval.

**Mitigation:** Action Gateway composes permission evaluation, approval state, Connector invocation and audit. Package/Connector authors must use the platform action boundary rather than bypassing it with direct uncontrolled side effects.

## 4. Security invariants

The following invariants should be treated as release blockers if violated:

1. A Production request cannot select its organization/member identity using client headers.
2. Production Local Development login cannot be enabled by configuration.
3. A disabled/deleted enterprise member cannot continue using an external identity binding.
4. An external provider subject cannot be rebound to another member without an explicit administrative migration mechanism.
5. Tenant-scoped data APIs cannot cross organization boundaries.
6. Remote Package import cannot automatically execute downloaded source.
7. A remote Package cannot become trusted solely because its signature is cryptographically valid; the signer fingerprint must also be trusted.
8. Runtime state must honor `OEAP_DATA_DIR` when configured.
9. Secret values must not be returned by configuration read APIs.
10. Release tags must match the repository version and pass the full release gate.

## 5. Residual risks / out-of-scope for 1.0 RC

- Full sandboxing of arbitrary third-party code.
- General row/field-level policy engine.
- HSM/KMS/Vault-backed key custody and rotation.
- Distributed rate limiting and horizontally shared Session/runtime state.
- PostgreSQL/object-store/vector-store production backends.
- SCIM lifecycle provisioning.
- Formal compliance certification or independent penetration test.

These items are not silently assumed safe. They are explicit boundaries for deployment architecture and post-1.0 work.

## 6. Independent review focus

An external reviewer should prioritize:

- Authentication/session fixation/token leakage.
- OAuth/OIDC state/PKCE/redirect handling and identity-binding logic.
- Cross-tenant authorization and object-level access controls.
- File upload/download/path traversal.
- Package import, provenance parsing, static scan bypasses and activation boundary.
- Connector secret encryption/key handling and UI/API redaction.
- Invitation-token handling and replay.
- AI context tenant isolation and provider data leakage.
- Backup/restore handling of encrypted state and keys.
- Reverse-proxy/CORS/CSP/HTTPS assumptions.

See `docs/security-review-checklist.md` for the executable review checklist.