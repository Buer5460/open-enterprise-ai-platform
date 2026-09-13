# Security Policy

OEAP 0.9.x is a production-candidate self-hosted platform. The project now implements explicit identity, tenancy, authorization, secret-storage and Package supply-chain boundaries, but security remains a deployment responsibility and the 1.0 compatibility/security contract is not yet frozen.

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

- Production mode requires authenticated Session identity.
- Production does not trust browser-supplied organization/member identity headers.
- GitHub, Google Workspace, Microsoft Entra ID and generic OIDC are supported.
- External identities map only to existing organization members.
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
- Imported Packages pass file/path constraints, static security scanning and dependency validation.
- Credential/private-key style files are rejected.
- Remote Package import does not automatically execute imported source.
- A valid signature from an untrusted key is not considered trusted.

See [docs/package-supply-chain.md](docs/package-supply-chain.md).

### Web and deployment

- Development and Production modes are distinct.
- Production reverse-proxy configuration adds CSP and standard browser security headers.
- `/health` is a liveness endpoint; `/ready` checks production readiness conditions.
- Production should use HTTPS and a strict CORS allowlist.
- Runtime state should be mounted through persistent `OEAP_DATA_DIR` storage and backed up.

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

If a secret is accidentally committed, revoke or rotate it. Deleting it from the latest commit is not enough because it may remain in Git history.

## Current limitations

The following remain deployment or post-0.9 hardening areas:

- Imported third-party code is not a full OS/container sandbox. Only trusted, reviewed Packages should ever be explicitly activated.
- Encryption-at-rest of application business databases depends on the deployment/storage layer.
- Enterprise HSM/KMS/Vault secret backends and automated key rotation are not yet core features.
- Row/field-level data-security policy is not yet a general platform primitive.
- Distributed rate limiting, queue isolation and horizontal runtime state are post-1.0 infrastructure work.
- A formal external security assessment has not yet been completed.

## High-risk workloads

OEAP's generic controls do not replace domain-specific security/compliance requirements. Real-money transfers, live trading, regulated medical decisioning, critical infrastructure, bulk external messaging and other high-impact actions require independent architecture/security review, stronger approval/key-management controls and appropriate regulatory processes before production use.

## Production minimum

Before routing users to a production deployment, complete [docs/production-checklist.md](docs/production-checklist.md) and confirm `/ready` returns HTTP 200.
