# OEAP Independent Security Review Checklist

Use this checklist for a third-party review of OEAP `1.0.0-rc.2`. Record evidence, affected commit/version, severity, reproduction steps and remediation status for each finding.

## A. Authentication and Session Security

- [ ] Verify Production ignores/replaces client-supplied organization/member identity headers.
- [ ] Verify every protected API requires a valid Session in Production.
- [ ] Verify `OEAP_LOCAL_AUTH=enabled` cannot reactivate local login in Production.
- [ ] Verify expired Sessions are rejected and removed.
- [ ] Verify disabled/deleted members lose Session access.
- [ ] Verify logout revokes the current token.
- [ ] Test Session token leakage through URL, Referer, logs, DOM and browser history.
- [ ] Test Session fixation and replay assumptions.
- [ ] Review Session TTL behavior and maximum bounds.

## B. OAuth / OIDC

For GitHub, Google, Microsoft and generic OIDC where practical:

- [ ] Test OAuth `state` entropy, single-use behavior and expiry.
- [ ] Test callback replay.
- [ ] Test provider mismatch against an existing state value.
- [ ] Confirm PKCE where enabled and validate verifier lifecycle.
- [ ] Test malicious/invalid callback code handling.
- [ ] Test open redirect possibilities through public Web/API URL configuration.
- [ ] Verify generic OIDC discovery/endpoints require HTTPS outside localhost.
- [ ] Verify GitHub first binding uses a verified email.
- [ ] Verify provider subject is authoritative after first identity binding.
- [ ] Verify a bound subject cannot silently migrate to another member through email changes.
- [ ] Verify a stale/disabled binding fails closed.
- [ ] Test the same email across multiple organizations and `OEAP_DEFAULT_ORG_ID` behavior.

## C. Tenancy and Authorization

Create at least two organizations and multiple roles/members.

- [ ] Attempt cross-organization application listing.
- [ ] Attempt cross-organization CRUD by changing app/entity/record IDs.
- [ ] Attempt cross-organization file access/deletion.
- [ ] Attempt cross-organization knowledge search/deletion.
- [ ] Attempt cross-organization Developer Studio/Marketplace access.
- [ ] Attempt cross-organization Connector-secret access.
- [ ] Attempt cross-organization operations/audit access.
- [ ] Verify app access scopes are enforced for reads and writes.
- [ ] Verify Viewer cannot write data.
- [ ] Verify Member/Manager/Admin/Owner boundaries.
- [ ] Verify custom roles cannot exceed the permissions actually assigned.
- [ ] Verify the last Owner cannot be removed.
- [ ] Review object-level authorization on every route with a path/query ID.

## D. Invitations and Membership

- [ ] Test invitation token entropy.
- [ ] Confirm stored invitation token is hashed for membership validation.
- [ ] Confirm re-delivery token material is encrypted at rest.
- [ ] Test invitation expiry.
- [ ] Test revoke behavior.
- [ ] Test one-time acceptance/replay.
- [ ] Test acceptance after role/app scope is changed or removed.
- [ ] Test cross-organization invitation revocation/acceptance attempts.
- [ ] Test existing-member email collisions.
- [ ] Verify invitation emails/templates cannot inject unsafe HTML or URLs.

## E. Secrets and Cryptography

- [ ] Verify Connector secret read APIs never return secret values.
- [ ] Verify mail/Connector/invitation/signing key files are excluded from Git.
- [ ] Review local encryption algorithms, IV/nonces and authentication tags.
- [ ] Review local key generation and filesystem permissions.
- [ ] Test corrupt/missing encryption keys and fail-closed behavior.
- [ ] Verify OAuth client secrets remain server-side.
- [ ] Verify GitHub Publisher/Marketplace tokens never reach browser responses/logs.
- [ ] Review signing private-key custody and rotation procedure.
- [ ] Confirm backups are classified as containing secrets even when some stores are encrypted.
- [ ] Verify the repository hygiene gate rejects tracked `.env`, SQLite, encrypted runtime stores, private keys and backup archives.
- [ ] Verify high-confidence credential patterns fail CI without exposing the matched secret value in logs.

## F. File and Attachment Security

- [ ] Test `../`, absolute paths, Unicode separators and encoded traversal in filenames/IDs.
- [ ] Verify downloaded files cannot escape organization storage roots.
- [ ] Verify filename/display-name sanitization.
- [ ] Test oversized file rejection.
- [ ] Test declared MIME type mismatch behavior.
- [ ] Test malicious HTML/SVG/script payload handling in downloads/UI.
- [ ] Verify file deletion cannot target another tenant's object.
- [ ] Review disk-exhaustion controls.

## G. Package Supply Chain

- [ ] Import an unsigned Package and confirm rejection.
- [ ] Import a correctly signed Package from an untrusted key and confirm rejection.
- [ ] Modify one signed byte and confirm digest/signature failure.
- [ ] Test symlink/submodule rejection.
- [ ] Test path traversal in repository entry names.
- [ ] Test >200 files, >2 MB single file and >12 MB aggregate limits.
- [ ] Attempt credential/private-key file names/content against static scanner.
- [ ] Attempt scanner bypass using minification, alternate syntax and nested files.
- [ ] Verify imported remote source is not automatically executed.
- [ ] Verify activation requires the intended permissions.
- [ ] Test exact, wildcard, caret, tilde, comparator, AND/OR and prerelease dependency ranges.
- [ ] Specifically test `^0.x` boundaries.
- [ ] Test Package ID/name collisions and version downgrade behavior.

## H. AI / Agent / Connector Boundary

- [ ] Verify enterprise knowledge retrieval is tenant-scoped.
- [ ] Verify App Builder/revision does not retrieve another organization's knowledge.
- [ ] Verify Agent enrichment does not cross tenant/app scope.
- [ ] Test prompt injection in enterprise knowledge that attempts to reveal secrets or change actions.
- [ ] Verify provider/Connector secrets are not injected into model prompts by default.
- [ ] Review action execution paths for bypasses around Permission Engine/Approval Engine/Action Gateway.
- [ ] Test high-impact Connector actions with required approvals.
- [ ] Confirm audit events are written for controlled side effects.

## I. Application Generation / Data Runtime

- [ ] Test malicious field/entity names for SQL injection and identifier escaping.
- [ ] Test schema revision with existing production-like data.
- [ ] Test rollback after failed/partial revision.
- [ ] Verify version snapshots cannot be used to access another tenant's application.
- [ ] Test relation/JSON/rich-text/attachment fields with hostile content.
- [ ] Review search/sort/pagination query construction for injection.

## J. Network / Web Security

- [ ] Verify Production public Web/API URLs require HTTPS.
- [ ] Verify Production rejects wildcard CORS.
- [ ] Verify cross-origin Production requires explicit HTTPS Origins.
- [ ] Verify same-origin deployment works with CORS disabled.
- [ ] Validate CSP against actual production frontend resources.
- [ ] Validate HSTS/X-Content-Type-Options/Referrer-Policy/frame protections at the reverse proxy.
- [ ] Test Host/X-Forwarded-* handling with and without trusted proxy mode.
- [ ] Test request body limits.
- [ ] Confirm `/health` and `/ready` do not leak secrets or tenant data.
- [ ] Run `pnpm preflight:production -- --env-file .env` and verify unsafe Production configuration fails closed.
- [ ] Run Production Preflight with `--live` against the review environment and validate Web/API reachability and reported security headers.
- [ ] Confirm Production Preflight never prints OAuth, mail or AI secret values.

## K. Persistence / Backup / Restore

- [ ] Confirm all runtime state honors `OEAP_DATA_DIR`.
- [ ] Test an absolute data directory.
- [ ] Test a relative data directory.
- [ ] Confirm no critical state is accidentally left under the repository `.tmp` when `OEAP_DATA_DIR` is set.
- [ ] Confirm backup refuses a reachable running OEAP API to reduce inconsistent SQLite copies.
- [ ] Confirm backup target inside `OEAP_DATA_DIR` is rejected.
- [ ] Confirm filesystem-root (`/`) runtime data configuration is rejected by backup/restore tooling.
- [ ] Confirm symlinks and special/device/socket/FIFO files in runtime data are rejected from filesystem backup.
- [ ] Execute a representative backup and verify the generated `.sha256` sidecar.
- [ ] Modify the backup archive and confirm restore rejects the checksum mismatch before changing current data.
- [ ] Test archive entries containing absolute paths and `..` traversal and confirm rejection before current data is modified.
- [ ] Test symlink, hard-link and special/device archive entries and confirm rejection.
- [ ] Confirm restore extracts to staging before switching live runtime data.
- [ ] Confirm restore creates a pre-restore safety copy when current runtime data exists.
- [ ] Restore into a clean environment and validate tenant/app/file/knowledge/Package state expectations.
- [ ] Verify backup/archive file permissions and deployment-side encryption policy.

## L. Availability / Abuse

- [ ] Test rapid login/authorization requests.
- [ ] Test repeated invitation generation/acceptance attempts.
- [ ] Test large/rapid file and Package uploads/imports.
- [ ] Test expensive knowledge searches and application-generation requests.
- [ ] Identify routes requiring upstream rate limiting before Internet exposure.
- [ ] Validate disk/memory/process behavior when dependencies are unavailable.

## M. Build / Release Supply Chain

- [ ] Verify `pnpm-lock.yaml` frozen installation.
- [ ] Review dependency provenance/supply-chain policy output.
- [ ] Verify release version consistency test.
- [ ] Verify tag/version mismatch blocks release.
- [ ] Verify RC releases create GitHub prereleases.
- [ ] Review GitHub Actions permissions for least privilege.
- [ ] Verify Release workflow does not expose secrets to untrusted PR code.
- [ ] Verify the source archive matches the released commit and its published SHA-256 digest.
- [ ] Confirm `1.0.0-rc.2` is the exact reviewed source baseline before filing findings.

## Finding severity guide

- **Critical:** cross-tenant admin/data compromise, unauthenticated remote code execution, signing/private-key compromise, systemic auth bypass.
- **High:** tenant data exposure/write, account takeover, secret extraction, remote Package trust bypass, approval bypass for high-impact actions.
- **Medium:** scoped authorization defect, stored/reflected injection with meaningful impact, DoS without systemic compromise, sensitive metadata leak.
- **Low:** hardening/configuration/documentation gap with limited direct exploitability.

## GA exit criterion

OEAP `1.0.0` GA should not be declared until:

1. Independent review is completed against the exact `v1.0.0-rc.2` tag or a later explicitly approved RC.
2. Critical/High findings are remediated or explicitly risk-accepted by the deployment/project owner.
3. Material Medium findings have remediation plans.
4. Remediations pass the full OEAP CI/release gate.
5. Production-owned OAuth/OIDC, DNS/TLS, backup/restore and required mail/AI integrations are validated in the target environment.
