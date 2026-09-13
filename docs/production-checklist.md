# OEAP Production Rollout Checklist

This checklist is for a self-hosted OEAP 0.9.x deployment.

## 1. Runtime

- Use Node.js 24+ for non-container deployments.
- Set `OEAP_DEPLOYMENT_MODE=production`.
- Set `NODE_ENV=production`.
- Set `OEAP_LOCAL_AUTH=disabled`.
- Mount a persistent `OEAP_DATA_DIR`.
- Confirm `/health` returns HTTP 200.
- Confirm `/ready` returns HTTP 200 before routing user traffic.

## 2. Identity

Configure at least one organization-owned identity provider:

- GitHub OAuth, or
- Google Workspace OAuth, or
- Microsoft Entra ID, or
- Enterprise OIDC.

External identities only map to existing OEAP members. Membership and role assignment remain controlled by OEAP invitations and organization administrators.

## 3. Public URLs and TLS

- Set `OEAP_PUBLIC_WEB_URL` to the HTTPS web origin.
- Set `OEAP_PUBLIC_API_URL` to the HTTPS API origin.
- Set `OEAP_CORS_ORIGINS` to the exact allowed web origin(s).
- Terminate TLS at a trusted reverse proxy/load balancer.
- Preserve `X-Forwarded-Proto` and enable `OEAP_TRUST_PROXY=true` only behind the trusted proxy.

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

- Provide the DeepSeek Harness checkout or another future compatible provider adapter.
- Store provider credentials outside the OEAP repository.
- Confirm the AI capability through the deployment environment before enabling business users.

Public CI intentionally does not execute live provider calls.

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
- Verify all declared dependencies are satisfied.
- Keep automatic execution disabled until explicit activation.

## 9. Backup and restore

- Schedule backups of `OEAP_DATA_DIR`.
- Store backups outside the running host/container volume.
- Test `scripts/restore-data.sh` against a non-production instance.
- Include organization SQLite data, files, knowledge, encrypted settings, signing keys and Package state in backup protection.

## 10. Operations

- Review the Deployment & Security panel.
- Review Operations & Approvals for errors and pending approvals.
- Monitor HTTP 5xx rates and storage consumption.
- Rotate connector/OAuth/mail credentials under normal enterprise secret-management policy.

## 11. High-risk workloads

OEAP provides platform-level authorization, approval and audit primitives, but high-risk domains such as real-money movement, live trading, regulated healthcare decisioning or critical infrastructure require domain-specific controls, independent review, stronger key management and appropriate compliance processes before production use.
