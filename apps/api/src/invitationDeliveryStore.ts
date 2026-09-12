import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface InvitationDeliveryEvent {
  id: number;
  invitationId: string;
  organizationId: string;
  provider: string;
  status: string;
  error?: string;
  createdAt: string;
}

export class InvitationDeliveryStore {
  private readonly db: DatabaseSync;
  private readonly encryptionKey: Buffer;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), {
      recursive: true
    });

    this.db = new DatabaseSync(databasePath);
    this.encryptionKey = loadEncryptionKey(
      `${databasePath}.invite-delivery-key`
    );

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invitation_delivery_secrets (
        invitation_id TEXT PRIMARY KEY,
        token_cipher TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invitation_delivery_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invitation_id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_invitation_delivery_events_org
        ON invitation_delivery_events(organization_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_invitation_delivery_events_invite
        ON invitation_delivery_events(invitation_id, id DESC);
    `);
  }

  saveToken(
    invitationId: string,
    token: string
  ): void {
    const now = new Date().toISOString();
    const cipher = encryptToken(
      token,
      this.encryptionKey
    );

    this.db.prepare(`
      INSERT INTO invitation_delivery_secrets
        (invitation_id, token_cipher, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(invitation_id) DO UPDATE SET
        token_cipher = excluded.token_cipher,
        updated_at = excluded.updated_at
    `).run(
      invitationId,
      cipher,
      now,
      now
    );
  }

  getToken(
    invitationId: string
  ): string | undefined {
    const row = this.db.prepare(`
      SELECT token_cipher
      FROM invitation_delivery_secrets
      WHERE invitation_id = ?
    `).get(invitationId) as any;

    if (!row?.token_cipher) {
      return undefined;
    }

    try {
      return decryptToken(
        String(row.token_cipher),
        this.encryptionKey
      );
    } catch {
      return undefined;
    }
  }

  deleteToken(
    invitationId: string
  ): void {
    this.db.prepare(`
      DELETE FROM invitation_delivery_secrets
      WHERE invitation_id = ?
    `).run(invitationId);
  }

  recordEvent(input: {
    invitationId: string;
    organizationId: string;
    provider: string;
    status: string;
    error?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO invitation_delivery_events
        (invitation_id, organization_id, provider, status, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.invitationId,
      input.organizationId,
      input.provider,
      input.status,
      input.error ?? null,
      new Date().toISOString()
    );
  }

  listEvents(
    organizationId: string,
    limit = 100
  ): InvitationDeliveryEvent[] {
    return this.db.prepare(`
      SELECT
        id,
        invitation_id,
        organization_id,
        provider,
        status,
        error,
        created_at
      FROM invitation_delivery_events
      WHERE organization_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(
      organizationId,
      Math.max(1, Math.min(limit, 500))
    ).map((row: any) => ({
      id: Number(row.id),
      invitationId: String(row.invitation_id),
      organizationId: String(row.organization_id),
      provider: String(row.provider),
      status: String(row.status),
      error: row.error ?? undefined,
      createdAt: String(row.created_at)
    }));
  }

  latestForInvitation(
    invitationId: string
  ): InvitationDeliveryEvent | undefined {
    const row = this.db.prepare(`
      SELECT
        id,
        invitation_id,
        organization_id,
        provider,
        status,
        error,
        created_at
      FROM invitation_delivery_events
      WHERE invitation_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(invitationId) as any;

    return row
      ? {
          id: Number(row.id),
          invitationId: String(row.invitation_id),
          organizationId: String(row.organization_id),
          provider: String(row.provider),
          status: String(row.status),
          error: row.error ?? undefined,
          createdAt: String(row.created_at)
        }
      : undefined;
  }
}

function loadEncryptionKey(
  keyPath: string
): Buffer {
  const configured =
    process.env.OEAP_INVITATION_ENCRYPTION_KEY;

  if (configured) {
    return createHash("sha256")
      .update(configured)
      .digest();
  }

  if (existsSync(keyPath)) {
    const raw = readFileSync(
      keyPath,
      "utf8"
    ).trim();
    const decoded = Buffer.from(raw, "base64");

    if (decoded.length === 32) {
      return decoded;
    }
  }

  const key = randomBytes(32);
  writeFileSync(
    keyPath,
    key.toString("base64"),
    { mode: 0o600 }
  );

  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // Some development filesystems may not support POSIX permissions.
  }

  return key;
}

function encryptToken(
  token: string,
  key: Buffer
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    key,
    iv
  );
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

function decryptToken(
  encoded: string,
  key: Buffer
): string {
  const [version, ivPart, tagPart, cipherPart] =
    encoded.split(".");

  if (
    version !== "v1" ||
    !ivPart ||
    !tagPart ||
    !cipherPart
  ) {
    throw new Error("Invalid invitation token cipher");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivPart, "base64url")
  );
  decipher.setAuthTag(
    Buffer.from(tagPart, "base64url")
  );

  return Buffer.concat([
    decipher.update(
      Buffer.from(cipherPart, "base64url")
    ),
    decipher.final()
  ]).toString("utf8");
}
