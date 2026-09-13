import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { runtimeStoragePath } from "./storagePath.js";
import {
  TenancyStore,
  type OrganizationMember
} from "./tenancyStore.js";

export type InvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export interface OrganizationInvitation {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  invitedName?: string;
  roleId: string;
  roleName: string;
  appIds: string[];
  status: InvitationStatus;
  createdBy?: string;
  createdAt: string;
  expiresAt: string;
  acceptedMemberId?: string;
  acceptedAt?: string;
}

export interface CreatedInvitation {
  invitation: OrganizationInvitation;
  token: string;
}

export class InvitationStore {
  private readonly db: DatabaseSync;
  private readonly tenancy: TenancyStore;

  constructor(databasePath: string) {
    const path = runtimeStoragePath(databasePath);

    mkdirSync(dirname(path), {
      recursive: true
    });

    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.tenancy = new TenancyStore(path);
    this.createSchema();
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organization_invitations (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        email TEXT NOT NULL,
        invited_name TEXT,
        role_id TEXT NOT NULL,
        app_ids TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        accepted_member_id TEXT,
        accepted_at TEXT,
        FOREIGN KEY (organization_id)
          REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (role_id)
          REFERENCES organization_roles(id),
        FOREIGN KEY (accepted_member_id)
          REFERENCES organization_members(id)
      );

      CREATE INDEX IF NOT EXISTS idx_org_invitations_org
        ON organization_invitations(organization_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_org_invitations_status
        ON organization_invitations(status, expires_at);
    `);
  }

  create(input: {
    organizationId: string;
    email: string;
    invitedName?: string;
    roleId: string;
    appIds?: string[];
    createdBy?: string;
    expiresHours?: number;
  }): CreatedInvitation {
    this.pruneExpired();

    const role = this.tenancy
      .listRoles(input.organizationId)
      .find((item) => item.id === input.roleId);

    if (!role) {
      throw new Error("Role does not belong to organization");
    }

    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new Error("A valid invitation email is required");
    }

    const id = `invite_${randomUUID()}`;
    const token = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(token);
    const now = new Date();
    const hours = Math.max(
      1,
      Math.min(input.expiresHours ?? 72, 24 * 30)
    );
    const expiresAt = new Date(
      now.getTime() + hours * 60 * 60 * 1000
    );

    const appIds = input.appIds?.length
      ? [...new Set(input.appIds)]
      : ["*"];

    this.db.prepare(`
      INSERT INTO organization_invitations (
        id, organization_id, email, invited_name,
        role_id, app_ids, token_hash, status,
        created_by, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      id,
      input.organizationId,
      email,
      input.invitedName?.trim() || null,
      input.roleId,
      JSON.stringify(appIds),
      tokenHash,
      input.createdBy ?? null,
      now.toISOString(),
      expiresAt.toISOString()
    );

    this.audit(
      input.organizationId,
      input.createdBy,
      "invitation.created",
      id,
      {
        email,
        roleId: input.roleId,
        appIds,
        expiresAt: expiresAt.toISOString()
      }
    );

    return {
      invitation: this.requireInvitation(id),
      token
    };
  }

  list(
    organizationId: string
  ): OrganizationInvitation[] {
    this.pruneExpired();

    return this.db.prepare(`
      SELECT
        i.*,
        o.name AS organization_name,
        r.name AS role_name
      FROM organization_invitations i
      JOIN organizations o
        ON o.id = i.organization_id
      JOIN organization_roles r
        ON r.id = i.role_id
      WHERE i.organization_id = ?
      ORDER BY i.created_at DESC
    `).all(organizationId)
      .map((row: any) => this.map(row));
  }

  getPublic(
    token: string
  ): OrganizationInvitation | undefined {
    this.pruneExpired();

    const row = this.db.prepare(`
      SELECT
        i.*,
        o.name AS organization_name,
        r.name AS role_name
      FROM organization_invitations i
      JOIN organizations o
        ON o.id = i.organization_id
      JOIN organization_roles r
        ON r.id = i.role_id
      WHERE i.token_hash = ?
    `).get(this.hashToken(token)) as any;

    return row
      ? this.map(row)
      : undefined;
  }

  revoke(
    invitationId: string,
    actorMemberId?: string
  ): OrganizationInvitation {
    const invitation =
      this.requireInvitation(invitationId);

    if (invitation.status !== "pending") {
      throw new Error(
        `Only pending invitations can be revoked (${invitation.status})`
      );
    }

    this.db.prepare(`
      UPDATE organization_invitations
      SET status = 'revoked'
      WHERE id = ?
    `).run(invitationId);

    this.audit(
      invitation.organizationId,
      actorMemberId,
      "invitation.revoked",
      invitationId,
      { email: invitation.email }
    );

    return this.requireInvitation(invitationId);
  }

  accept(input: {
    token: string;
    name?: string;
  }): {
    invitation: OrganizationInvitation;
    member: OrganizationMember;
  } {
    this.pruneExpired();

    const invitation = this.getPublic(input.token);

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    if (invitation.status !== "pending") {
      throw new Error(
        `Invitation is ${invitation.status}`
      );
    }

    const existing = this.tenancy
      .listMembers(invitation.organizationId)
      .find(
        (member) =>
          member.email.toLowerCase() ===
          invitation.email.toLowerCase()
      );

    if (existing) {
      throw new Error(
        "This email is already a member of the organization"
      );
    }

    const member = this.tenancy.createMember({
      organizationId: invitation.organizationId,
      name:
        input.name?.trim() ||
        invitation.invitedName ||
        invitation.email.split("@")[0] ||
        "Invited Member",
      email: invitation.email,
      roleId: invitation.roleId,
      appIds: invitation.appIds,
      actorMemberId: invitation.createdBy
    });

    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE organization_invitations
      SET
        status = 'accepted',
        accepted_member_id = ?,
        accepted_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(
      member.id,
      now,
      invitation.id
    );

    this.audit(
      invitation.organizationId,
      member.id,
      "invitation.accepted",
      invitation.id,
      {
        email: invitation.email,
        roleId: invitation.roleId,
        memberId: member.id
      }
    );

    return {
      invitation:
        this.requireInvitation(invitation.id),
      member
    };
  }

  private requireInvitation(
    invitationId: string
  ): OrganizationInvitation {
    this.pruneExpired();

    const row = this.db.prepare(`
      SELECT
        i.*,
        o.name AS organization_name,
        r.name AS role_name
      FROM organization_invitations i
      JOIN organizations o
        ON o.id = i.organization_id
      JOIN organization_roles r
        ON r.id = i.role_id
      WHERE i.id = ?
    `).get(invitationId) as any;

    if (!row) {
      throw new Error(
        `Invitation not found: ${invitationId}`
      );
    }

    return this.map(row);
  }

  private pruneExpired(): void {
    this.db.prepare(`
      UPDATE organization_invitations
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= ?
    `).run(new Date().toISOString());
  }

  private hashToken(token: string): string {
    return createHash("sha256")
      .update(token)
      .digest("hex");
  }

  private map(row: any): OrganizationInvitation {
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      organizationName:
        String(row.organization_name),
      email: String(row.email),
      invitedName:
        row.invited_name ?? undefined,
      roleId: String(row.role_id),
      roleName: String(row.role_name),
      appIds: JSON.parse(row.app_ids || "[]"),
      status: row.status as InvitationStatus,
      createdBy: row.created_by ?? undefined,
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
      acceptedMemberId:
        row.accepted_member_id ?? undefined,
      acceptedAt:
        row.accepted_at ?? undefined
    };
  }

  private audit(
    organizationId: string,
    actorMemberId: string | undefined,
    action: string,
    invitationId: string,
    details: unknown
  ): void {
    this.db.prepare(`
      INSERT INTO tenancy_audit
        (organization_id, actor_member_id, action, subject_type, subject_id, details)
      VALUES (?, ?, ?, 'invitation', ?, ?)
    `).run(
      organizationId,
      actorMemberId ?? null,
      action,
      invitationId,
      JSON.stringify(details ?? null)
    );
  }
}
