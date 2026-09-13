import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { runtimeStoragePath } from "./storagePath.js";

export type AuthProviderId =
  | "local"
  | "github"
  | "google"
  | "microsoft"
  | "oidc";

export type ExternalAuthProviderId = Exclude<
  AuthProviderId,
  "local"
>;

export interface AuthSession {
  token: string;
  provider: AuthProviderId;
  organizationId: string;
  memberId: string;
  subject?: string;
  email?: string;
  name?: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuthIdentityBinding {
  provider: ExternalAuthProviderId;
  subject: string;
  organizationId: string;
  memberId: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
}

export class AuthSessionStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    const path = runtimeStoragePath(databasePath);

    mkdirSync(dirname(path), {
      recursive: true
    });

    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        subject TEXT,
        email TEXT,
        name TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_member
        ON auth_sessions(organization_id, member_id);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
        ON auth_sessions(expires_at);

      CREATE TABLE IF NOT EXISTS auth_identity_bindings (
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        email TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, subject)
      );
      CREATE INDEX IF NOT EXISTS idx_auth_identity_bindings_member
        ON auth_identity_bindings(organization_id, member_id);
    `);
  }

  create(input: {
    provider: AuthProviderId;
    organizationId: string;
    memberId: string;
    subject?: string;
    email?: string;
    name?: string;
    ttlHours?: number;
  }): AuthSession {
    this.pruneExpired();

    if (
      input.provider !== "local" &&
      input.subject?.trim()
    ) {
      this.bindIdentity({
        provider: input.provider,
        subject: input.subject,
        organizationId: input.organizationId,
        memberId: input.memberId,
        email: input.email
      });
    }

    const token = `oeap_${randomUUID().replaceAll("-", "")}`;
    const now = new Date();
    const expires = new Date(
      now.getTime() +
      (input.ttlHours ?? 12) * 60 * 60 * 1000
    );

    this.db.prepare(`
      INSERT INTO auth_sessions (
        token, provider, organization_id, member_id,
        subject, email, name, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      token,
      input.provider,
      input.organizationId,
      input.memberId,
      input.subject ?? null,
      input.email ?? null,
      input.name ?? null,
      now.toISOString(),
      expires.toISOString()
    );

    return this.require(token);
  }

  get(token: string): AuthSession | undefined {
    this.pruneExpired();

    const row = this.db.prepare(`
      SELECT * FROM auth_sessions
      WHERE token = ?
    `).get(token) as any;

    return row
      ? this.map(row)
      : undefined;
  }

  require(token: string): AuthSession {
    const session = this.get(token);

    if (!session) {
      throw new Error("Session not found or expired");
    }

    return session;
  }

  revoke(token: string): void {
    this.db.prepare(
      "DELETE FROM auth_sessions WHERE token = ?"
    ).run(token);
  }

  revokeMember(
    organizationId: string,
    memberId: string
  ): void {
    this.db.prepare(`
      DELETE FROM auth_sessions
      WHERE organization_id = ? AND member_id = ?
    `).run(organizationId, memberId);
  }

  getIdentityBinding(
    provider: ExternalAuthProviderId,
    subject: string
  ): AuthIdentityBinding | undefined {
    const normalizedSubject = subject.trim();
    if (!normalizedSubject) {
      return undefined;
    }

    const row = this.db.prepare(`
      SELECT
        provider,
        subject,
        organization_id,
        member_id,
        email,
        created_at,
        updated_at
      FROM auth_identity_bindings
      WHERE provider = ? AND subject = ?
    `).get(
      provider,
      normalizedSubject
    ) as any;

    return row
      ? mapIdentityBinding(row)
      : undefined;
  }

  bindIdentity(input: {
    provider: ExternalAuthProviderId;
    subject: string;
    organizationId: string;
    memberId: string;
    email?: string;
  }): AuthIdentityBinding {
    const subject = input.subject.trim();
    if (!subject) {
      throw new Error("External identity subject is required");
    }

    const existing = this.getIdentityBinding(
      input.provider,
      subject
    );

    if (
      existing &&
      (
        existing.organizationId !== input.organizationId ||
        existing.memberId !== input.memberId
      )
    ) {
      throw new Error(
        "External identity is already bound to a different enterprise member"
      );
    }

    const now = new Date().toISOString();

    if (existing) {
      this.db.prepare(`
        UPDATE auth_identity_bindings
        SET email = ?, updated_at = ?
        WHERE provider = ? AND subject = ?
      `).run(
        input.email?.trim().toLowerCase() || null,
        now,
        input.provider,
        subject
      );
    } else {
      this.db.prepare(`
        INSERT INTO auth_identity_bindings (
          provider,
          subject,
          organization_id,
          member_id,
          email,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.provider,
        subject,
        input.organizationId,
        input.memberId,
        input.email?.trim().toLowerCase() || null,
        now,
        now
      );
    }

    return this.getIdentityBinding(
      input.provider,
      subject
    )!;
  }

  private pruneExpired(): void {
    this.db.prepare(
      "DELETE FROM auth_sessions WHERE expires_at <= ?"
    ).run(new Date().toISOString());
  }

  private map(row: any): AuthSession {
    return {
      token: String(row.token),
      provider: row.provider as AuthProviderId,
      organizationId: String(row.organization_id),
      memberId: String(row.member_id),
      subject: row.subject ?? undefined,
      email: row.email ?? undefined,
      name: row.name ?? undefined,
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at)
    };
  }
}

function mapIdentityBinding(
  row: any
): AuthIdentityBinding {
  return {
    provider: row.provider as ExternalAuthProviderId,
    subject: String(row.subject),
    organizationId: String(row.organization_id),
    memberId: String(row.member_id),
    email: row.email ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function bearerToken(
  authorization: string | undefined
): string | undefined {
  if (!authorization) {
    return undefined;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}
