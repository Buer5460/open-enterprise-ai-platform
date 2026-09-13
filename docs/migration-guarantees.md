# OEAP 1.x Migration Guarantees

This document defines the migration promises for OEAP 1.x. It covers generated application Blueprints, runtime state and platform upgrades.

## General rule

OEAP 1.x upgrades must preserve existing tenant data by default. A platform upgrade may add schema, metadata or indexes automatically, but it must not silently delete tenant data, remove application fields, drop entities, revoke memberships, or overwrite Connector secrets.

## Generated application Blueprints

For the 1.x line:

- Existing Blueprint fields keep their meaning.
- New Blueprint fields must be optional or have a deterministic default.
- Unknown optional Blueprint fields must be preserved when possible.
- AI revision creates a new application version instead of mutating historical snapshots.
- Additive schema changes may be applied automatically.
- Destructive changes such as field deletion, entity deletion or incompatible type conversion require an explicit migration path and must not be performed silently.
- Application rollback restores a previous Blueprint/package version; it does not automatically destroy data added by a later version.

## Generated application SQLite data

OEAP keeps generated-application data isolated by organization and application.

For 1.x:

- Existing tables and columns are not dropped automatically during ordinary upgrade/revision flows.
- New fields may add columns or supporting metadata.
- Existing row identifiers remain stable.
- Rollback must prefer compatibility over destructive database reversal.
- Administrators should back up runtime data before platform upgrades and before intentionally destructive application migrations.

## Platform runtime state

`OEAP_DATA_DIR` is the persistent runtime root. Backups must include the entire configured runtime root, not only generated application databases.

Runtime state includes, where configured:

- tenancy and RBAC
- authentication sessions and external identity bindings
- application Blueprints, versions and data
- Developer Studio and Marketplace assets
- enterprise files and knowledge data
- operation/audit/approval state
- invitations and invitation-delivery state
- encrypted mail, brand and Connector configuration
- Package provenance/trust metadata

Within 1.x, file locations under the runtime root may be reorganized only when OEAP supplies an automatic migration or an explicitly documented migration command.

## Upgrade procedure

Before upgrading a production installation:

1. Stop writes or schedule a maintenance window.
2. Back up the complete `OEAP_DATA_DIR`.
3. Record the current OEAP release/tag and deployment configuration.
4. Deploy the target release.
5. Wait for `/ready` to return success.
6. Run the release smoke/E2E checks.
7. Resume traffic.

## Rollback procedure

If an upgrade fails:

1. Stop the failed release.
2. Restore the previous application/container release.
3. If the failed release performed a documented irreversible migration, restore the pre-upgrade `OEAP_DATA_DIR` backup.
4. Wait for `/ready` and run smoke checks before restoring traffic.

## Breaking migrations

A migration that requires destructive data transformation, manual SQL, or a non-backward-compatible Blueprint change is considered breaking. Such a migration requires either:

- a new platform major version, or
- an explicitly opt-in migration tool with backup/rollback instructions.

No 1.x patch release may require a destructive migration.
