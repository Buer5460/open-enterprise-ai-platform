# OEAP Enterprise Deployment Guide

This guide separates the local development experience from a hardened enterprise deployment.

For the fastest first-use path, see [5-minute quickstart](quickstart-5-minutes.md).

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
- CORS is open by default so a local frontend can reach the API.
- Public web/API URLs are optional.
- Runtime data uses `OEAP_DATA_DIR` when configured; otherwise the repository `.tmp` directory is the compatibility default.
- AI is optional: template applications and core business features work without an AI provider.

This mode is for development and controlled validation only.

## 2. Production mode

Set:

```bash
OEAP_DEPLOYMENT_MODE=production
NODE_ENV=production
OEAP_LOCAL_AUTH=disabled
```

Production mode changes the identity trust model:

- Browser-supplied `x-oeap-org` and `x-oeap-member` headers are not trusted as production identity.
- Protected API routes require a valid server-side OEAP Session.
- Local Development login is hard-disabled in Production.
- Public invitation inspection/acceptance and authentication entry routes remain accessible.
- CORS is closed when `OEAP_CORS_ORIGINS` is not configured.

Do not expose a production instance until Production Preflight and the Deployment & Security Center have no blocking items.

## 3. Required production settings

At minimum, plan these values:

```bash
OEAP_DEPLOYMENT_MODE=production
NODE_ENV=production
OEAP_LOCAL_AUTH=disabled
OEAP_PUBLIC_WEB_URL=https://ai.example.com
OEAP_PUBLIC_API_URL=https://ai.example.com
OEAP_DATA_DIR=/var/lib/oeap
```

For same-origin Web/API deployment, `OEAP_CORS_ORIGINS` can remain empty. For split origins, configure only approved HTTPS origins:

```bash
OEAP_CORS_ORIGINS=https://console.example.com
```

`OEAP_CORS_ORIGINS` accepts a comma-separated list when more than one approved Web origin needs API access.

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

External identities are bound to OEAP organization members and then evaluated through the same tenancy/RBAC layer as local sessions.

## 5. Organization isolation and RBAC

OEAP evaluates authorization using organization membership, role permissions and application access scope.

Production requests receive organization/member identity from a validated Session. This prevents callers from elevating privileges by manually submitting OEAP identity headers.

Recommended production roles:

- Owner: organization-wide administrative authority.
- Admin: membership, application and platform administration.
- Manager: business operations and approved application access.
- Member: day-to-day application data access.
- Viewer: read-only access.

Create narrower custom roles instead of giving broad administrative permissions to service users.

## 6. AI Runtime

AI is not required for core OEAP operation. Template apps, data CRUD/import/export, files, knowledge, permissions, approvals and Marketplace capabilities continue to work when AI is offline.

OEAP 1.1 supports two AI Runtime paths.

### DeepSeek Harness

```bash
OEAP_AI_PROVIDER=deepseek-harness
OEAP_HARNESS_ROOT=/opt/deepseek-harness
OEAP_DSH_HOME=/var/lib/oeap-dsh
```

Keep Harness on the same host or a trusted private runtime boundary. Do not expose the Harness service directly to the public Internet.

### OpenAI-Compatible API

This path can be used with OpenAI, DeepSeek API, newAPI, private gateways and other compatible `/chat/completions` endpoints.

```bash
OEAP_AI_PROVIDER=openai-compatible
OEAP_OPENAI_BASE_URL=https://api.example.com/v1
OEAP_OPENAI_API_KEY=...
OEAP_OPENAI_MODEL=...
OEAP_OPENAI_TIMEOUT_MS=120000
```

`auto` is also supported:

```bash
OEAP_AI_PROVIDER=auto
```

When a complete organization-level OpenAI-Compatible configuration exists in the encrypted Connector Vault, auto mode can use it; otherwise OEAP can fall back to DeepSeek Harness when available.

Organization administrators can configure the compatible Provider directly from **AI Runtime**. The API key is encrypted server-side and is never returned to the browser after saving.

## 7. Mail delivery

Each organization can configure its own mail provider from **Enterprise & Permissions → Enterprise Mail Service**.

Supported providers:

- Manual invitation link
- Resend
- Enterprise webhook
- SMTP

Provider secrets are not returned to the browser after they are saved. Local configuration storage is encrypted before it is written to runtime data.

Environment-based mail settings remain available as a deployment fallback; prefer organization-level UI settings when operating a multi-tenant instance.

## 8. Enterprise branding

Each organization can configure:

- Organization name and short name
- Logo URL
- Primary color
- Login/identity copy
- Invitation email subject
- Email signature and footer

The same brand configuration is applied to the OEAP shell and invitation messages.

## 9. Persistent storage

`OEAP_DATA_DIR` is the production runtime root for persistent OEAP state. Core stores, generated applications, application databases, Sessions, tenancy data, OAuth state, branding/mail settings, Connector secrets, knowledge, Marketplace commerce state and other runtime assets must remain on durable storage.

Example:

```bash
OEAP_DATA_DIR=/var/lib/oeap
```

Operational rules:

1. Back `OEAP_DATA_DIR` with durable storage or a persistent container volume.
2. Encryption key files inside the runtime tree must be protected and backed up with the encrypted state they unlock.
3. Never commit the runtime directory or secret/key files to source control.
4. Use the supplied backup/restore scripts rather than copying a live SQLite tree blindly.
5. Perform a restore drill before onboarding production organizations.

The supplied backup flow includes SHA-256 integrity verification and archive path/link/special-file hardening.

## 10. Reverse proxy and TLS

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
          └── AI Provider boundary
                ├── OpenAI-Compatible HTTPS API
                └── DeepSeek Harness (private/local)
```

## 11. Production Preflight

Before starting production traffic:

```bash
corepack pnpm preflight:production -- --env-file .env
```

After deployment:

```bash
corepack pnpm preflight:production -- --env-file .env --live
```

Preflight checks:

- Production deployment mode
- Local Auth safety
- OAuth/OIDC availability
- HTTPS public Web/API URLs
- CORS semantics
- Session TTL
- persistent `OEAP_DATA_DIR`
- mail configuration presence
- AI Provider mode
- DeepSeek Harness / OpenAI-Compatible configuration completeness
- live Web/API reachability
- `/health` and `/ready`
- key Web security headers

Explicitly selecting `openai-compatible` with only part of Base URL / API Key / Model configured is a blocking error. In `auto` mode, missing AI configuration is a warning rather than a blocker because core OEAP remains usable without AI.

## 12. Marketplace boundary

OEAP 1.1 includes an Agent/Package Marketplace registry and organization-scoped acquisition/entitlement foundations.

For production paid plans:

- keep payment provider credentials in a server-side Connector or secret store;
- verify asynchronous payment events server-side;
- never grant entitlement based only on browser redirect parameters;
- keep orders and entitlements organization-scoped;
- audit entitlement lifecycle changes.

The built-in commerce model is a platform foundation, not a claim that a third-party payment processor is already configured.

## 13. Go-live checklist

Verify:

- Production deployment mode is active.
- Local Development login is disabled.
- At least one enterprise identity provider is configured.
- Public Web and API URLs are defined and HTTPS.
- CORS is restricted to approved origins when cross-origin.
- `OEAP_DATA_DIR` is durable and protected.
- Mail is configured when automated invitations are required.
- Enterprise branding is complete.
- AI Provider is configured if natural-language generation/revision is required.
- `NODE_ENV=production`.
- Backups and restore have been tested.
- TLS/DNS are production-owned and verified.
- Independent security review requirements are satisfied for the intended exposure level.

The readiness score and Preflight are operational controls, not substitutes for infrastructure penetration testing, dependency scanning, database backup validation or an organization-specific security review.
