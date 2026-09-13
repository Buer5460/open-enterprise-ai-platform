# OEAP Production Rollout Checklist

This checklist is for a self-hosted OEAP **1.0 release-candidate** deployment. It does not replace an independent security review or organization-specific compliance controls.

## 1. Runtime and automated preflight

- Use Node.js 24+ for non-container deployments.
- Set `OEAP_DEPLOYMENT_MODE=production`.
- Set `NODE_ENV=production`.
- Leave `OEAP_LOCAL_AUTH` unset or set it to `disabled`. Production code hard-disables Local Development login even if an unsafe override attempts to enable it.
- Mount a persistent `OEAP_DATA_DIR`; never point it at `/`.
- Run the local configuration preflight before startup:

```bash
pnpm preflight:production -- --env-file .env
```

- After DNS/TLS/reverse proxy are live, run the network-aware preflight:

```bash
pnpm preflight:production -- --env-file .env --live
```

The preflight reports configuration state but never prints OAuth/client-secret values. `--live` checks the public Web endpoint, `/health`, `/ready`, TLS reachability and key Web security headers.

- Confirm `/health` returns HTTP 200.
- Confirm `/ready` returns HTTP 200 before routing user traffic.
- Confirm the version reported by `/health` matches the intended deployment release.

## 2. Identity

Configure at least one organization-owned identity provider:

- GitHub OAuth, or
- Google Workspace OAuth, or
- Microsoft Entra ID, or
- Enterprise OIDC.

External identities only map to existing OEAP members. On first external login the verified enterprise identity is matched to an existing member; subsequent logins use a stable provider-subject binding. Membership and role assignment remain controlled by OEAP invitations and organization administrators.

## 3. Public URLs, TLS and CORS

- Set `OEAP_PUBLIC_WEB_URL` to a valid HTTPS Web URL.
- Set `OEAP_PUBLIC_API_URL` to a valid HTTPS API URL.
- Terminate TLS at a trusted reverse proxy/load balancer.
- Preserve `X-Forwarded-Proto` and enable `OEAP_TRUST_PROXY=true` only behind the trusted proxy.
- Prefer same-origin Web/API deployment; in that case `OEAP_CORS_ORIGINS` may remain unset and Production CORS stays fail-closed.
- If Web/API are cross-origin, set `OEAP_CORS_ORIGINS` to the exact trusted HTTPS Web origin(s).
- Never use `OEAP_CORS_ORIGINS=*` in Production; the API rejects wildcard Production origins.
- CORS entries must be origin-only URLs without path, query or fragment.

## 4. Enterprise mail

Configure one of:

- SMTP
- Resend
- Enterprise webhook

The manual-link provider remains supported, but automatic invitation delivery will be unavailable.

## 5. Branding

For each organization configure:

- Organization name and short name
- Logo
- Primary color
- Login title/subtitle
- Invitation subject, signature and footer

## 6. AI runtime

When AI generation/revision is required:

- Provide the DeepSeek Harness checkout or another compatible provider adapter.
- Store provider credentials outside the OEAP repository.
- Confirm the AI capability through the actual deployment environment before enabling business users.

Public CI intentionally does not execute live provider calls because they require an external runtime checkout and private provider credentials.

## 7. Connector credentials

Use the OEAP encrypted Connector credential vault for organization-scoped secrets. Do not embed API keys, tokens, passwords, private keys or OAuth client secrets in Package source.

For Package publishing/import:

- `oeap.github-publisher`: `TOKEN`, `OWNER`, `REPOSITORY`, optional `BRANCH`, `PREFIX`.
- `oeap.github-marketplace`: optional private-repo `TOKEN`, plus trusted publisher `TRUSTED_FINGERPRINTS`.

## 8. Package supply chain

Before importing third-party Packages:

- Require Ed25519 provenance.
- Pin/approve the publisher SHA-256 fingerprint.
- Review static security scan findings.
- Review requested permissions/capabilities.
- Verify all declared dependencies and SemVer ranges are satisfied.
- Keep automatic execution disabled until explicit activation.

## 9. Backup and restore

- Stop the OEAP API before using the filesystem backup script; the script refuses to back up a reachable running API to avoid inconsistent SQLite snapshots.
- Create a backup with `pnpm backup` or `scripts/backup-data.sh`.
- Store the `.tar.gz` and its generated `.sha256` sidecar outside the running host/container data volume.
- Backup creation rejects targets inside `OEAP_DATA_DIR`, filesystem-root data directories, symbolic links and special/device files.
- Restore verifies the SHA-256 sidecar when present.
- Restore validates archive member paths before touching existing data and rejects `..`/absolute traversal paths, symlinks, hard links and special/device files.
- Restore first extracts to a staging directory and creates a pre-restore safety copy of existing runtime data before replacing it.
- Test `scripts/restore-data.sh` against a non-production instance.
- Perform at least one restore drill using the same storage topology intended for Production.
- Include organization SQLite data, files, knowledge, encrypted settings, signing keys and Package state in backup protection.

CI exercises a real backup → mutation → restore flow, checksum-tamper rejection and (on GNU tar) a path-traversal archive rejection. The Production deployment still needs its own restore drill because host storage/permissions are environment-specific.

## 10. Repository and secret hygiene

- Never commit `.env`, SQLite databases, encrypted runtime stores, private keys or backup archives.
- CI scans tracked files for runtime-state filenames and common high-confidence credential/private-key patterns.
- If a credential is ever committed, rotate/revoke it even after deleting the file from the current branch because Git history may retain the value.

## 11. Operations

- Review the Deployment & Security panel until critical checks pass.
- Review Operations & Approvals for errors and pending approvals.
- Monitor HTTP 5xx rates and storage consumption.
- Rotate connector/OAuth/mail credentials under normal enterprise secret-management policy.
- Keep `/ready` on the load-balancer readiness path; it is intentionally unauthenticated and returns 503 for unsafe/incomplete production configuration.

## 12. Release and external review

Before a public Internet-facing 1.0 GA rollout:

- Use a tagged release whose SemVer matches the platform package version.
- Complete an independent external security review against a specific RC tag.
- Resolve material findings before GA sign-off.
- Validate real OAuth/OIDC callbacks, mail delivery, DNS/TLS and backup/restore in the deployment environment.
- Record who approved the production configuration and release version.

Review package:

- [threat-model.md](threat-model.md)
- [security-review-checklist.md](security-review-checklist.md)
- [release-readiness.md](release-readiness.md)
- [../SECURITY.md](../SECURITY.md)

## 13. High-risk workloads

OEAP provides platform-level authorization, approval and audit primitives, but high-risk domains such as real-money movement, live trading, regulated healthcare decisioning or critical infrastructure require domain-specific controls, independent review, stronger key management and appropriate compliance processes before production use.
