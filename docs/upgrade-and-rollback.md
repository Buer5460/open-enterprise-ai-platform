# OEAP Upgrade and Rollback Contract

This document defines the operational contract for OEAP 0.9.x and the compatibility direction for 1.0.

## Before every platform upgrade

1. Stop business writes or place the deployment in a maintenance window.
2. Back up the entire `OEAP_DATA_DIR` using `scripts/backup-data.sh` or an equivalent storage snapshot.
3. Record the currently deployed Git commit/tag and container image IDs.
4. Run the target version's CI-equivalent build/test process in staging.
5. Confirm `/ready` is healthy in staging with production-equivalent identity and URL configuration.
6. Review `CHANGELOG.md` for migration notes.

## Runtime-data compatibility

OEAP persists several categories of state under the runtime data root:

- tenancy and role/member data
- authenticated sessions
- generated application Blueprints and versions
- organization-isolated SQLite application databases
- files/attachments
- enterprise knowledge
- operations and approvals
- encrypted mail/Connector settings and their keys
- Developer Studio and Marketplace Packages
- Package provenance/signing material

Minor releases in the same stable major line are expected to preserve existing state or perform additive migrations. Destructive migrations must be explicitly documented before a stable 1.0 release can use them.

## Generated application rollback

The application-level rollback mechanism is independent from platform rollback:

- Every AI application revision archives the previous Blueprint/version.
- Restoring a historical Blueprint creates a new current application version.
- Existing business records are not deleted by a Blueprint restore.
- Additive database columns may remain after a Blueprint rollback; rollback is intentionally non-destructive to user data.

## Package compatibility

Package Manifest schema compatibility follows these rules:

- Schema `1.x` is the compatibility family targeted for OEAP 1.0.
- Unknown optional fields in a newer `1.x` manifest may be preserved with a warning.
- A different schema major is rejected until the runtime explicitly supports it.
- Package upgrades within the same Package semantic-version major may be considered compatible when the new version is not lower than the installed version.
- A Package semantic-version major change requires an explicit migration/review decision.

## Platform rollback

If a new deployment fails after rollout:

1. Stop the new application containers/processes.
2. Preserve the failed runtime data directory separately for investigation.
3. Restore the pre-upgrade backup to a fresh runtime-data location/volume.
4. Deploy the previous known-good OEAP image/tag.
5. Confirm `/health`, `/ready`, authentication and organization access.
6. Verify representative generated-application records and attachments before reopening writes.

Do not attempt to repair a failed upgrade by deleting selected SQLite or encryption-key files. State and encrypted configuration must be restored as a consistent set.

## Database migrations

Until PostgreSQL/multi-node infrastructure becomes a stable backend, OEAP uses additive SQLite schema evolution where possible. A future stable migration framework must provide:

- ordered migration identifiers
- idempotent application
- precondition/version checks
- transactional migrations where supported
- explicit backup requirements for destructive operations
- migration-status visibility in readiness/operations

## Production policy

Never upgrade production directly from an arbitrary branch head. Use a reviewed release/tag or a deployment artifact built from a known commit. External dependencies such as OAuth/OIDC, mail providers, AI runtimes and enterprise Connectors should be tested in staging because public CI intentionally cannot hold production secrets.
