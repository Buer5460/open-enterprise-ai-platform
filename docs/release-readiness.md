# OEAP 1.0 Release Readiness

This document separates **source-code release readiness** from **deployment-owned production validation**. OEAP does not treat a green build as proof that an organization's OAuth tenant, DNS/TLS, mail provider, AI provider, backup process or external security posture has been independently validated.

## Current release

- Platform: `1.0.0-rc.2`
- Package Manifest contract: `1.x`
- TypeScript SDK contract: `1.x`
- Runtime requirement: Node.js 24+
- Workspace package manager: pnpm 11.7.0 through Corepack
- Status: Release Candidate, not General Availability

## Automated release gates

Every `main` change must pass the following CI stages:

1. Frozen-lockfile install and supply-chain policy validation.
2. Full workspace TypeScript/Vite build.
3. Release-version consistency contract.
4. Repository secret/runtime-state hygiene scan.
5. Production Preflight configuration regression.
6. Package Manifest compatibility fixtures.
7. SDK public API contract test.
8. Package SemVer dependency-range regression test.
9. Action Gateway / Skill / Agent / Workflow runtime tests.
10. Tenancy/RBAC and multi-tenant isolation tests.
11. Session and external-identity-binding tests.
12. Invitation, mail settings and invitation-delivery tests.
13. Production authentication/security regression test.
14. Package provenance/static-scan/supply-chain test.
15. Runtime storage-root (`OEAP_DATA_DIR`) test.
16. Backup/restore security regression: real restore, checksum tamper and archive traversal rejection.
17. Built API end-to-end test, including liveness/readiness/session/platform probes.
18. Real headless Chrome end-to-end smoke test for core workspace navigation and uncaught runtime exceptions.
19. Shell-script validation.
20. Docker Compose validation.
21. API production container build.
22. Web production container build.

A Release repeats the release-version contract, build, deterministic test suite, real-browser E2E, Compose validation and both container builds before GitHub Release creation. Release candidates publish as GitHub prereleases.

## Security behavior frozen for the RC

### Identity

- Production ignores browser-provided `x-oeap-org` and `x-oeap-member` identity selection.
- Protected production APIs require a valid OEAP Session.
- Local Development login is hard-disabled in Production even if `OEAP_LOCAL_AUTH=enabled` is mistakenly supplied.
- OAuth `state` is one-time and time-limited; PKCE is used where supported.
- Existing external accounts are resolved using stable provider-subject bindings before email lookup.
- A stale/disabled subject binding fails closed and is not silently transferred to another member by matching email.
- GitHub first binding requires an email returned by GitHub as verified.

### Network/deployment boundary

- Production public Web and API URLs must use HTTPS.
- Production CORS rejects `*`.
- Cross-origin production deployment requires an explicit HTTPS Origin whitelist.
- Same-origin production may keep CORS disabled.
- `/health` is a liveness probe.
- `/ready` is a public infrastructure readiness probe and fails when required production identity/public URL configuration is unsafe or incomplete.
- `pnpm preflight:production -- --env-file .env` validates Production configuration without exposing secrets.
- `--live` mode validates deployed Web/API reachability and key Web security headers.

### Multi-tenancy

- Organization/member identity is enforced server-side.
- Generated application data uses organization-scoped databases outside the legacy local-development compatibility path.
- Developer Studio, organization Marketplace, files, knowledge, operations, credentials and access scopes are organization-isolated.
- Remote Package import requires `packages.manage`.

### Package supply chain

- Remote Package imports require a trusted publisher fingerprint.
- Ed25519 provenance and SHA-256 content digests are verified.
- Static security scan runs before Marketplace import.
- Symlinks/submodules are rejected.
- Import size and file-count limits are enforced.
- Dependency ranges are evaluated using fail-closed SemVer rules, including correct `^0.x` behavior.
- Imported remote source is not automatically executed.

### Secrets and persistent state

- Runtime state is rooted under `OEAP_DATA_DIR` when configured.
- Mail/brand/Connector/invitation-delivery secrets use encrypted local stores or deployment environment secrets.
- CI rejects tracked runtime databases, encrypted local stores, backup archives, private-key files and high-confidence credential patterns.
- Secrets must not be committed to Git.

### Backup and restore

- Filesystem backup refuses a reachable running API to reduce SQLite-copy inconsistency.
- Backup target cannot live inside `OEAP_DATA_DIR`; `/` cannot be the runtime data root.
- Backup input must contain only normal directories/files; links and special files are rejected.
- New backup archives include a SHA-256 sidecar.
- Restore verifies the sidecar when present, validates archive paths/types before touching current state, extracts to staging first, then creates a pre-restore safety copy before switching data.
- Path traversal, links and special archive entries fail closed.

## Security-review package

The repository includes a review-ready security package:

- [`docs/threat-model.md`](threat-model.md) — assets, trust boundaries, threats, mitigations, invariants and residual risk.
- [`docs/security-review-checklist.md`](security-review-checklist.md) — executable independent review / penetration-test checklist and severity guide.
- [`SECURITY.md`](../SECURITY.md) — reporting policy, security boundaries and known limitations.
- [`docs/production-checklist.md`](production-checklist.md) — deployment-side production controls.
- GitHub issue #6 — external GA security/deployment validation tracker.

The package is intended to make an independent review reproducible against a specific RC commit/tag; it is not a self-certification.

## Known external/GA gates

The following are deliberately **not** self-certified by the repository and must be completed by the deployment owner before 1.0 General Availability or an Internet-facing production rollout:

- Independent external security review and remediation of material findings.
- Real OAuth/OIDC tenant/application configuration and callback validation.
- Production DNS, TLS certificate and reverse-proxy validation.
- Production mail delivery validation if automatic invitation mail is required.
- Backup **and restore** drill against the actual persistent volume/object storage used by the deployment.
- AI runtime/provider credentials and a live end-to-end generation test when AI generation is enabled.
- Organization-specific data-retention, privacy, compliance and incident-response controls.

## Release decision

`1.0.0-rc.2` is the repository-owned 1.0 engineering baseline and recommended prerelease for independent review. The controlled release trigger is the `[release] OEAP 1.0.0-rc.2` commit; the Release workflow repeats version checks, builds, deterministic tests, real-browser E2E, Compose validation and both production container builds before creating the prerelease.

It must remain a prerelease until the external security-review gate has been completed and deployment-specific production controls have been validated. A future `1.0.0` GA tag must not be created merely by changing the version number; the external gates above should be explicitly signed off by the project/deployment owner.
