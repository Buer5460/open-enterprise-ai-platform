import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type OrganizationPackageStatus =
  | "enabled"
  | "disabled";

export class OrganizationPackageStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organization_packages (
        organization_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (organization_id, package_id)
      );
      CREATE INDEX IF NOT EXISTS idx_org_packages_package_status
        ON organization_packages (package_id, status);
    `);
  }

  get(
    organizationId: string,
    packageId: string
  ): OrganizationPackageStatus | undefined {
    const row = this.db.prepare(`
      SELECT status
      FROM organization_packages
      WHERE organization_id = ? AND package_id = ?
    `).get(organizationId, packageId) as
      | { status?: string }
      | undefined;

    return row?.status === "enabled" ||
      row?.status === "disabled"
      ? row.status
      : undefined;
  }

  set(
    organizationId: string,
    packageId: string,
    status: OrganizationPackageStatus
  ): void {
    this.db.prepare(`
      INSERT INTO organization_packages
        (organization_id, package_id, status, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(organization_id, package_id)
      DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      organizationId,
      packageId,
      status,
      new Date().toISOString()
    );
  }

  countEnabled(packageId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM organization_packages
      WHERE package_id = ? AND status = 'enabled'
    `).get(packageId) as { total?: number } | undefined;

    return Number(row?.total ?? 0);
  }

  list(organizationId: string): Array<{
    packageId: string;
    status: OrganizationPackageStatus;
    updatedAt: string;
  }> {
    return (this.db.prepare(`
      SELECT package_id, status, updated_at
      FROM organization_packages
      WHERE organization_id = ?
      ORDER BY package_id ASC
    `).all(organizationId) as any[]).map((row) => ({
      packageId: String(row.package_id),
      status: row.status as OrganizationPackageStatus,
      updatedAt: String(row.updated_at)
    }));
  }
}
