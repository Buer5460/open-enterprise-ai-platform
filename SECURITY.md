# Security Policy

OEAP `1.0.0-rc.2` is a self-hosted release candidate with explicit identity, tenancy, authorization, secret-storage, persistence, backup/recovery and Package supply-chain boundaries. The 1.x Package/SDK compatibility contract is frozen for the RC, but General Availability still requires independent security review and deployment-specific validation.

See also:

- [docs/threat-model.md](docs/threat-model.md)
- [docs/security-review-checklist.md](docs/security-review-checklist.md)
- [docs/release-readiness.md](docs/release-readiness.md)
- [docs/production-checklist.md](docs/production-checklist.md)

## Reporting a vulnerability

Do not publish exploitable vulnerabilities in a public issue.

Contact the repository owner privately through GitHub and include:

- Affected component and version/commit
- Reproduction steps
- Expected and actual behavior
- Potential impact
- Whether credentials, cross-tenant access or code execution are involved
- Suggested mitigation, if known

## Platform security boundaries

### Identity and tenancy

- Production requires authenticated Session identity for protected APIs.
- Production does not trust browser-supplied organization/member identity headers.
- Local Development login is hard-disabled in Production, including when an unsafe override attempts to enable it.
- GitHub, Google Workspace, Microsoft Entra ID and generic OIDC are supported.
- OAuth state is single-use/time-limited and PKCE is used where supported.
- External identities map only to existing organization members.
- Existing external accounts resolve through stable provider-subject bindings before email lookup.
- A stale or disabled identity binding fails closed rather than silently rebinding by email.
- Organization RBAC and app-access scopes are enforced server-side.
- Generated applications, databases and organization-local Package assets are isolated by organization.

### Actions and side effects

- Permission Engine evaluates action policy.
- Approval Engine represents explicit human authorization.
- Action Gateway combines permission, approval, Connector execution and audit.
- Connector credentials are stored outside Package source in an encrypted organization-scoped vault.

### Package supply chain

Third-party Packages are treated as executable software:

- Developer Packages can be content-hashed and signed with Ed25519.
- Remote imports require valid provenance and an explicitly trusted publisher fingerprint.
- Imported Packages pass file/path constraints, static security scanning and fail-closed dependency validation.
- Credential/private-key style files are rejected.
- Symlinks/submodules are rejected for remote GitHub imports.
- File-count, per-file and aggregate-size bounds are enforced.
- Remote Package import does not automatically execute imported source.
- A valid signature from an untrusted key is not considered trusted.
- Package dependency SemVer includes correct zero-major caret behavior.

See [docs/package-supply-chain.md](docs/package-supply-chain.md).

### Web and deployment

- Development and Production modes are distinct.
- Production public Web/API URLs must use HTTPS.
- Production CORS is fail-closed; wildcard origins are rejected.
- Cross-origin production deployments require explicit HTTPS origin allowlists.
- Production reverse-proxy configuration adds CSP and standard browser security headers.
- `/health` is a liveness endpoint; `/ready` is a public infrastructure readiness probe that fails unsafe/incomplete production configuration without exposing tenant data.
- `pnpm preflight:production -- --env-file .env` validates Production configuration without printing secret values; `--live` additionally checks the deployed Web/API boundary.
- Runtime state should be mounted through persistent `OEAP_DATA_DIR` storage and backed up.

### Backup and recovery

- Filesystem backups refuse a reachable running API to reduce inconsistent SQLite copies.
- Backup targets inside `OEAP_DATA_DIR`, filesystem-root runtime data, links and special files are rejected.
- New backups include a SHA-256 sidecar.
- Restore verifies integrity when a sidecar exists and validates archive paths/types before changing runtime data.
- Restore rejects absolute/`..` traversal paths, symbolic/hard links and special/device files.
- Restore extracts to staging and creates a pre-restore safety copy before replacing current runtime data.

## Secrets

Never commit:

- API keys or access tokens
- OAuth client secrets
- Passwords
- Private keys
- Local `.env` files
- Connector credential vault data/keys
- DeepSeek Harness/provider credentials
- Local SQLite databases containing real business data
- OEAP signing private keys
- Runtime encrypted stores and backup archives

CI contains a repository-hygiene gate that rejects tracked runtime-state/secrets and common high-confidence credential patterns. If a secret is accidentally committed, revoke or rotate it. Deleting it from the latest commit is not enough because it may remain in Git history.

## Current limitations / residual risks

The following remain deployment or post-1.0 infrastructure/security areas:

- Imported third-party code is not a full OS/container sandbox. Only trusted, reviewed Packages should ever be explicitly activated.
- Encryption-at-rest of application business databases depends on the deployment/storage layer.
- Enterprise HSM/KMS/Vault secret backends and automated key rotation are not yet core features.
- Row/field-level data-security policy is not yet a general platform primitive.
- Distributed rate limiting, queue isolation and horizontal runtime state are post-1.0 infrastructure work.
- Production-grade PostgreSQL/object-storage/vector-store backends are post-1.0 work.
- A formal independent external security assessment has not yet been completed for `1.0.0-rc.2`.

These are explicit boundaries, not assumptions that the missing controls are unnecessary.

## High-risk workloads

OEAP's generic controls do not replace domain-specific security/compliance requirements. Real-money transfers, live trading, regulated medical decisioning, critical infrastructure, bulk external messaging and other high-impact actions require independent architecture/security review, stronger approval/key-management controls and appropriate regulatory processes before production use.

## Automated security regression gates

Current CI includes:

- Production authentication and identity-spoofing tests
- External identity binding/rebinding tests
- Multi-tenant isolation tests
- Invitation/mail/security-state tests
- Package provenance/static scan/supply-chain tests
- Package SemVer dependency edge cases
- Runtime data-root persistence tests
- Backup/restore integrity and archive-traversal tests
- Repository runtime-state/credential hygiene scanning
- Production Preflight regression
- Built API E2E
- Real headless Chrome workspace navigation/runtime-exception detection
- Docker Compose and production container builds

Green CI is required for release candidates, but it is not a substitute for an independent assessment.

## Production minimum

Before routing users to a production deployment:

1. Complete [docs/production-checklist.md](docs/production-checklist.md).
2. Run Production Preflight against the actual configuration and again with `--live` after DNS/TLS is active.
3. Confirm `/ready` returns HTTP 200 in the actual deployment.
4. Validate OAuth/OIDC, DNS/TLS, backup/restore and required mail/AI integrations with deployment-owned credentials.
5. For General Availability or high-impact production use, complete the independent review described in [docs/security-review-checklist.md](docs/security-review-checklist.md).