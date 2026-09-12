# OEAP Enterprise Deployment Guide

This guide separates the local development experience from a hardened enterprise deployment.

## 1. Development mode

Development mode is the default when `OEAP_DEPLOYMENT_MODE` is not set to `production`.

Typical local settings:

```bash
OEAP_DEPLOYMENT_MODE=development
NODE_ENV=development
```

In development mode:

- Local Development login is enabled by default.
- OEAP can bootstrap `org_local / member_local_owner` for local testing.
- CORS is open by default so the Vite development server can reach the API.
- Public web/API URLs are optional.
- Runtime data remains under the repository `.tmp` directory unless deployment storage is added later.

This mode is for development and validation only.

## 2. Production mode

Set:

```bash
OEAP_DEPLOYMENT_MODE=production
NODE_ENV=production
OEAP_LOCAL_AUTH=disabled
```

Production mode changes the identity trust model:

- Browser-supplied `x-oeap-org` and `x-oeap-member` headers are ignored.
- Protected API routes require a valid server-side OEAP Session.
- Local Development login is disabled by default even if `OEAP_LOCAL_AUTH` is omitted.
- Public invitation inspection/acceptance and authentication entry routes remain accessible.
- CORS is closed when `OEAP_CORS_ORIGINS` is not configured.

Do not expose a production instance until the Deployment & Security Center reports no blocking items.

## 3. Required production settings

At minimum, plan these values:

```bash
OEAP_DEPLOYMENT_MODE=production
NODE_ENV=production
OEAP_LOCAL_AUTH=disabled
OEAP_PUBLIC_WEB_URL=https://ai.example.com
OEAP_PUBLIC_API_URL=https://ai-api.example.com
OEAP_CORS_ORIGINS=https://ai.example.com
```

`OEAP_CORS_ORIGINS` accepts a comma-separated list when more than one approved web origin needs API access.

## 4. Enterprise identity

A production deployment should configure at least one external identity provider.

### GitHub OAuth

```bash
OEAP_GITHUB_CLIENT_ID=...
OEAP_GITHUB_CLIENT_SECRET=...
```

### Google Workspace

```bash
OEAP_GOOGLE_CLIENT_ID=...
OEAP_GOOGLE_CLIENT_SECRET=...
```

### Microsoft Entra ID

```bash
OEAP_MICROSOFT_CLIENT_ID=...
OEAP_MICROSOFT_CLIENT_SECRET=...
```

### Generic OIDC

```bash
OEAP_OIDC_ISSUER=https://id.example.com
OEAP_OIDC_CLIENT_ID=...
OEAP_OIDC_CLIENT_SECRET=...
```

The provider abstraction already separates identity from RBAC. Provider callback/exchange logic should remain adapter-specific rather than being embedded into business APIs.

## 5. Organization isolation and RBAC

OEAP evaluates authorization using organization membership, role permissions and application access scope.

Production requests receive organization/member identity only from a validated Session. This prevents callers from elevating privileges by manually submitting OEAP identity headers.

Recommended production roles:

- Owner: organization-wide administrative authority.
- Admin: membership, application and platform administration.
- Manager: business operations and approved application access.
- Member: day-to-day application data access.
- Viewer: read-only access.

Create narrower custom roles instead of giving broad administrative permissions to service users.

## 6. Mail delivery

Each organization can configure its own mail provider from **Enterprise & Permissions → Enterprise Mail Service**.

Supported providers:

- Manual invitation link
- Resend
- Enterprise webhook
- SMTP

Provider secrets are not returned to the browser after they are saved. Local configuration storage is encrypted before it is written to runtime data.

Environment-based mail settings remain available as a deployment fallback; prefer organization-level UI settings when operating a multi-tenant instance.

## 7. Enterprise branding

Each organization can configure:

- Organization name and short name
- Logo URL
- Primary color
- Login/identity copy
- Invitation email subject
- Email signature and footer

The same brand configuration is applied to the OEAP shell and invitation messages.

## 8. Persistent storage

Local development currently uses `.tmp` for sessions, tenant metadata, encrypted settings and generated application runtime data.

Before production deployment:

1. Back the runtime directory with durable storage.
2. Ensure encryption key files are included in the protected persistent volume but excluded from source control and public backups.
3. Back up tenant databases and generated application databases together with their encryption keys.
4. Test restore procedures before onboarding production organizations.

`OEAP_DATA_DIR` is reserved as the deployment-level persistent storage target. The readiness center reports its presence so deployments can track storage migration explicitly.

## 9. Reverse proxy and TLS

Run the public site behind an HTTPS reverse proxy or managed ingress. Terminate TLS using a trusted certificate and forward only the required API/Web endpoints.

Recommended boundary:

```text
Internet
   │
 HTTPS / WAF / reverse proxy
   ├── Web frontend
   └── OEAP API
          ├── Session + RBAC
          ├── Tenant data
          ├── Mail / identity providers
          └── DeepSeek Harness adapter (private network)
```

Do not expose DeepSeek Harness directly to the public Internet. Keep Harness and internal connectors on a private network reachable only by OEAP services that require them.

## 10. Go-live checklist

Use **Enterprise & Permissions → Enterprise Brand → Deployment & Security Center** and verify:

- Production deployment mode is active.
- Local Development login is disabled.
- At least one enterprise identity provider is configured.
- Public Web and API URLs are defined.
- CORS is restricted to approved origins.
- Mail is configured when automated invitations are required.
- Enterprise brand information is complete.
- Encryption key files and runtime databases are on durable storage.
- `NODE_ENV=production`.
- Backups, restore and TLS have been tested.

The readiness score is an operational checklist, not a substitute for infrastructure penetration testing, dependency scanning, database backup validation or an organization-specific security review.
