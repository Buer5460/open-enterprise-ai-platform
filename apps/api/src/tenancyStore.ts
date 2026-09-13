import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { runtimeStoragePath } from "./storagePath.js";

export type MemberStatus = "active" | "disabled";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface OrganizationRole {
  id: string;
  organizationId: string;
  name: string;
  permissions: string[];
  system: boolean;
  createdAt: string;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  status: MemberStatus;
  roleId: string;
  roleName: string;
  appIds: string[];
  createdAt: string;
}

export interface OrganizationContext {
  organization: Organization;
  roles: OrganizationRole[];
  members: OrganizationMember[];
}

const SYSTEM_ROLES: Array<{
  key: string;
  name: string;
  permissions: string[];
}> = [
  {
    key: "owner",
    name: "Owner",
    permissions: ["*"]
  },
  {
    key: "admin",
    name: "Admin",
    permissions: [
      "org.read",
      "org.manage",
      "members.read",
      "members.manage",
      "apps.read",
      "apps.manage",
      "data.read",
      "data.write",
      "packages.read",
      "packages.manage"
    ]
  },
  {
    key: "manager",
    name: "Manager",
    permissions: [
      "org.read",
      "members.read",
      "apps.read",
      "data.read",
      "data.write",
      "packages.read"
    ]
  },
  {
    key: "member",
    name: "Member",
    permissions: [
      "apps.read",
      "data.read",
      "data.write",
      "packages.read"
    ]
  },
  {
    key: "viewer",
    name: "Viewer",
    permissions: [
      "apps.read",
      "data.read",
      "packages.read"
    ]
  }
];

export class TenancyStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    const path = runtimeStoragePath(databasePath);

    mkdirSync(dirname(path), {
      recursive: true
    });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.createSchema();
    this.bootstrapLocalOrganization();
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS organization_roles (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        name TEXT NOT NULL,
        permissions TEXT NOT NULL,
        system INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS organization_members (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        role_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES organization_roles(id)
      );
      CREATE TABLE IF NOT EXISTS member_app_access (
        member_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        PRIMARY KEY (member_id, app_id),
        FOREIGN KEY (member_id) REFERENCES organization_members(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS tenancy_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL,
        actor_member_id TEXT,
        action TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  private bootstrapLocalOrganization(): void {
    const existing = this.db
      .prepare("SELECT id FROM organizations WHERE id = ?")
      .get("org_local");

    if (existing) return;

    this.db
      .prepare("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)")
      .run("org_local", "Local OEAP Organization", "local");

    const roleIds = this.seedSystemRoles("org_local");

    this.db.prepare(`
      INSERT INTO organization_members
        (id, organization_id, name, email, status, role_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "member_local_owner",
      "org_local",
      "Local Owner",
      "owner@local.oeap",
      "active",
      roleIds.owner
    );

    this.db
      .prepare("INSERT INTO member_app_access (member_id, app_id) VALUES (?, ?)")
      .run("member_local_owner", "*");
  }

  private seedSystemRoles(organizationId: string): Record<string, string> {
    const ids: Record<string, string> = {};

    for (const role of SYSTEM_ROLES) {
      const id = `role_${role.key}_${organizationId}`;
      ids[role.key] = id;
      this.db.prepare(`
        INSERT INTO organization_roles
          (id, organization_id, name, permissions, system)
        VALUES (?, ?, ?, ?, 1)
      `).run(
        id,
        organizationId,
        role.name,
        JSON.stringify(role.permissions)
      );
    }

    return ids;
  }

  listOrganizations(): Organization[] {
    return this.db.prepare(`
      SELECT id, name, slug, created_at
      FROM organizations
      ORDER BY created_at ASC
    `).all().map((row: any) => this.mapOrganization(row));
  }

  createOrganization(input: {
    name: string;
    slug?: string;
    ownerName?: string;
    ownerEmail?: string;
  }): OrganizationContext {
    const id = `org_${randomUUID()}`;
    const slug = this.safeSlug(input.slug || input.name);

    this.db
      .prepare("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)")
      .run(id, input.name.trim(), slug);

    const roleIds = this.seedSystemRoles(id);
    const ownerId = `member_${randomUUID()}`;

    this.db.prepare(`
      INSERT INTO organization_members
        (id, organization_id, name, email, status, role_id)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(
      ownerId,
      id,
      input.ownerName?.trim() || "Organization Owner",
      input.ownerEmail?.trim() || `owner@${slug}.local`,
      roleIds.owner
    );

    this.db
      .prepare("INSERT INTO member_app_access (member_id, app_id) VALUES (?, ?)")
      .run(ownerId, "*");

    this.audit(id, ownerId, "organization.created", "organization", id, {
      name: input.name,
      slug
    });

    return this.getContext(id);
  }

  getContext(organizationId: string): OrganizationContext {
    const row = this.db.prepare(`
      SELECT id, name, slug, created_at
      FROM organizations
      WHERE id = ?
    `).get(organizationId) as any;

    if (!row) {
      throw new Error(`Organization not found: ${organizationId}`);
    }

    return {
      organization: this.mapOrganization(row),
      roles: this.listRoles(organizationId),
      members: this.listMembers(organizationId)
    };
  }

  listRoles(organizationId: string): OrganizationRole[] {
    return this.db.prepare(`
      SELECT id, organization_id, name, permissions, system, created_at
      FROM organization_roles
      WHERE organization_id = ?
      ORDER BY system DESC, name ASC
    `).all(organizationId).map((row: any) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      permissions: JSON.parse(row.permissions || "[]"),
      system: Boolean(row.system),
      createdAt: row.created_at
    }));
  }

  createRole(input: {
    organizationId: string;
    name: string;
    permissions: string[];
    actorMemberId?: string;
  }): OrganizationRole {
    const id = `role_${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO organization_roles
        (id, organization_id, name, permissions, system)
      VALUES (?, ?, ?, ?, 0)
    `).run(
      id,
      input.organizationId,
      input.name.trim(),
      JSON.stringify(input.permissions)
    );

    this.audit(
      input.organizationId,
      input.actorMemberId,
      "role.created",
      "role",
      id,
      input
    );

    return this.listRoles(input.organizationId)
      .find((role) => role.id === id)!;
  }

  updateRole(
    roleId: string,
    input: {
      name?: string;
      permissions?: string[];
      actorMemberId?: string;
    }
  ): OrganizationRole {
    const current = this.requireRole(roleId);
    this.db.prepare(`
      UPDATE organization_roles
      SET name = ?, permissions = ?
      WHERE id = ?
    `).run(
      input.name?.trim() || current.name,
      JSON.stringify(input.permissions ?? current.permissions),
      roleId
    );

    this.audit(
      current.organizationId,
      input.actorMemberId,
      "role.updated",
      "role",
      roleId,
      input
    );

    return this.requireRole(roleId);
  }

  listMembers(organizationId: string): OrganizationMember[] {
    const rows = this.db.prepare(`
      SELECT
        m.id, m.organization_id, m.name, m.email, m.status,
        m.role_id, m.created_at, r.name AS role_name
      FROM organization_members m
      JOIN organization_roles r ON r.id = m.role_id
      WHERE m.organization_id = ?
      ORDER BY m.created_at ASC
    `).all(organizationId) as any[];

    const accessStatement = this.db.prepare(
      "SELECT app_id FROM member_app_access WHERE member_id = ? ORDER BY app_id ASC"
    );

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      email: row.email,
      status: row.status,
      roleId: row.role_id,
      roleName: row.role_name,
      appIds: (accessStatement.all(row.id) as any[])
        .map((entry) => String(entry.app_id)),
      createdAt: row.created_at
    }));
  }

  createMember(input: {
    organizationId: string;
    name: string;
    email: string;
    roleId: string;
    appIds?: string[];
    actorMemberId?: string;
  }): OrganizationMember {
    const role = this.requireRole(input.roleId);

    if (role.organizationId !== input.organizationId) {
      throw new Error("Role does not belong to organization");
    }

    const id = `member_${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO organization_members
        (id, organization_id, name, email, status, role_id)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(
      id,
      input.organizationId,
      input.name.trim(),
      input.email.trim(),
      input.roleId
    );

    this.setMemberAppAccess(
      id,
      input.appIds?.length ? input.appIds : ["*"]
    );

    this.audit(
      input.organizationId,
      input.actorMemberId,
      "member.created",
      "member",
      id,
      { email: input.email, roleId: input.roleId }
    );

    return this.requireMember(id);
  }

  updateMember(
    memberId: string,
    input: {
      name?: string;
      email?: string;
      roleId?: string;
      status?: MemberStatus;
      actorMemberId?: string;
    }
  ): OrganizationMember {
    const current = this.requireMember(memberId);
    const nextRoleId = input.roleId ?? current.roleId;
    const role = this.requireRole(nextRoleId);

    if (role.organizationId !== current.organizationId) {
      throw new Error("Role does not belong to organization");
    }

    this.db.prepare(`
      UPDATE organization_members
      SET name = ?, email = ?, role_id = ?, status = ?
      WHERE id = ?
    `).run(
      input.name?.trim() || current.name,
      input.email?.trim() || current.email,
      nextRoleId,
      input.status ?? current.status,
      memberId
    );

    this.audit(
      current.organizationId,
      input.actorMemberId,
      "member.updated",
      "member",
      memberId,
      input
    );

    return this.requireMember(memberId);
  }

  deleteMember(memberId: string, actorMemberId?: string): void {
    const member = this.requireMember(memberId);
    const ownerRole = this.listRoles(member.organizationId)
      .find((role) => role.name === "Owner");

    if (ownerRole?.id === member.roleId) {
      const ownerCount = this.listMembers(member.organizationId)
        .filter((item) => item.roleId === ownerRole.id)
        .length;
      if (ownerCount <= 1) {
        throw new Error("Cannot delete the last organization owner");
      }
    }

    this.db
      .prepare("DELETE FROM organization_members WHERE id = ?")
      .run(memberId);

    this.audit(
      member.organizationId,
      actorMemberId,
      "member.deleted",
      "member",
      memberId,
      { email: member.email }
    );
  }

  setMemberAppAccess(
    memberId: string,
    appIds: string[],
    actorMemberId?: string
  ): OrganizationMember {
    const member = this.requireMember(memberId);

    this.db
      .prepare("DELETE FROM member_app_access WHERE member_id = ?")
      .run(memberId);

    const insert = this.db.prepare(
      "INSERT INTO member_app_access (member_id, app_id) VALUES (?, ?)"
    );

    for (const appId of [...new Set(appIds)]) {
      insert.run(memberId, appId);
    }

    this.audit(
      member.organizationId,
      actorMemberId,
      "member.app_access.updated",
      "member",
      memberId,
      { appIds }
    );

    return this.requireMember(memberId);
  }

  grantMemberAppAccess(
    memberId: string,
    appId: string,
    actorMemberId?: string
  ): OrganizationMember {
    const member = this.requireMember(memberId);

    if (member.appIds.includes("*") || member.appIds.includes(appId)) {
      return member;
    }

    this.db.prepare(`
      INSERT OR IGNORE INTO member_app_access (member_id, app_id)
      VALUES (?, ?)
    `).run(memberId, appId);

    this.audit(
      member.organizationId,
      actorMemberId,
      "member.app_access.granted",
      "member",
      memberId,
      { appId }
    );

    return this.requireMember(memberId);
  }

  authorize(input: {
    organizationId: string;
    memberId: string;
    permission: string;
    appId?: string;
  }): boolean {
    const member = this.requireMember(input.memberId);

    if (
      member.organizationId !== input.organizationId ||
      member.status !== "active"
    ) {
      return false;
    }

    const role = this.requireRole(member.roleId);
    const hasPermission =
      role.permissions.includes("*") ||
      role.permissions.includes(input.permission);

    if (!hasPermission) return false;
    if (!input.appId) return true;

    return (
      member.appIds.includes("*") ||
      member.appIds.includes(input.appId)
    );
  }

  listAudit(
    organizationId: string,
    limit = 100
  ): Array<Record<string, unknown>> {
    return this.db.prepare(`
      SELECT id, actor_member_id, action, subject_type, subject_id, details, created_at
      FROM tenancy_audit
      WHERE organization_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(
      organizationId,
      Math.max(1, Math.min(limit, 500))
    ).map((row: any) => ({
      id: row.id,
      actorMemberId: row.actor_member_id,
      action: row.action,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      details: row.details ? JSON.parse(row.details) : null,
      createdAt: row.created_at
    }));
  }

  private requireRole(roleId: string): OrganizationRole {
    const row = this.db.prepare(`
      SELECT id, organization_id, name, permissions, system, created_at
      FROM organization_roles
      WHERE id = ?
    `).get(roleId) as any;

    if (!row) throw new Error(`Role not found: ${roleId}`);

    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      permissions: JSON.parse(row.permissions || "[]"),
      system: Boolean(row.system),
      createdAt: row.created_at
    };
  }

  private requireMember(memberId: string): OrganizationMember {
    const row = this.db.prepare(`
      SELECT organization_id
      FROM organization_members
      WHERE id = ?
    `).get(memberId) as any;

    if (!row) throw new Error(`Member not found: ${memberId}`);

    return this.listMembers(row.organization_id)
      .find((member) => member.id === memberId)!;
  }

  private mapOrganization(row: any): Organization {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: row.created_at
    };
  }

  private safeSlug(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || `org-${Date.now()}`;
  }

  private audit(
    organizationId: string,
    actorMemberId: string | undefined,
    action: string,
    subjectType: string,
    subjectId: string | undefined,
    details: unknown
  ): void {
    this.db.prepare(`
      INSERT INTO tenancy_audit
        (organization_id, actor_member_id, action, subject_type, subject_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      organizationId,
      actorMemberId ?? null,
      action,
      subjectType,
      subjectId ?? null,
      JSON.stringify(details ?? null)
    );
  }
}
