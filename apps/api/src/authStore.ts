import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type AuthProviderId =
  | "local"
  | "github"
  | "google"
  | "microsoft"
  | "oidc";

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

export class AuthSessionStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), {
      recursive: true
    });

    this.db = new DatabaseSync(databasePath);
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

export function bearerToken(
  authorization: string | undefined
): string | undefined {
  if (!authorization) {
    return undefined;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}
