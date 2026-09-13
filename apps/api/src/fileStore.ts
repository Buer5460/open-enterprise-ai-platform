import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { runtimeStoragePath } from "./storagePath.js";

export interface StoredFile {
  id: string;
  organizationId: string;
  appId?: string;
  uploadedBy: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export class EnterpriseFileStore {
  private readonly db: DatabaseSync;
  private readonly filesRoot: string;

  constructor(
    databasePath: string,
    filesRoot: string
  ) {
    const resolvedDatabasePath =
      runtimeStoragePath(databasePath);
    this.filesRoot =
      runtimeStoragePath(filesRoot);

    mkdirSync(dirname(resolvedDatabasePath), { recursive: true });
    mkdirSync(this.filesRoot, { recursive: true });
    this.db = new DatabaseSync(resolvedDatabasePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enterprise_files (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        app_id TEXT,
        uploaded_by TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_enterprise_files_org_created
        ON enterprise_files (organization_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_enterprise_files_app
        ON enterprise_files (organization_id, app_id, created_at DESC);
    `);
  }

  create(input: {
    organizationId: string;
    appId?: string;
    uploadedBy: string;
    name: string;
    mimeType?: string;
    bytes: Buffer;
  }): StoredFile {
    const id = `file_${randomUUID()}`;
    const safeOrg = safeSegment(input.organizationId);
    const extension = safeExtension(input.name);
    const relativePath = join(
      safeOrg,
      `${id}${extension}`
    );
    const absolutePath = join(
      this.filesRoot,
      relativePath
    );

    mkdirSync(dirname(absolutePath), {
      recursive: true
    });
    writeFileSync(absolutePath, input.bytes, {
      mode: 0o600
    });

    const createdAt = new Date().toISOString();
    const sha256 = createHash("sha256")
      .update(input.bytes)
      .digest("hex");

    this.db.prepare(`
      INSERT INTO enterprise_files
        (id, organization_id, app_id, uploaded_by, name, mime_type,
         size, sha256, relative_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.organizationId,
      input.appId || null,
      input.uploadedBy,
      sanitizeDisplayName(input.name),
      input.mimeType?.trim() || "application/octet-stream",
      input.bytes.length,
      sha256,
      relativePath,
      createdAt
    );

    return this.requireMetadata(id);
  }

  list(input: {
    organizationId: string;
    appId?: string;
    limit?: number;
  }): StoredFile[] {
    const limit = Math.max(
      1,
      Math.min(input.limit ?? 100, 500)
    );

    const rows = input.appId
      ? this.db.prepare(`
          SELECT * FROM enterprise_files
          WHERE organization_id = ? AND app_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(
          input.organizationId,
          input.appId,
          limit
        )
      : this.db.prepare(`
          SELECT * FROM enterprise_files
          WHERE organization_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(
          input.organizationId,
          limit
        );

    return (rows as any[]).map(mapFile);
  }

  get(
    organizationId: string,
    id: string
  ): StoredFile | undefined {
    const row = this.db.prepare(`
      SELECT * FROM enterprise_files
      WHERE id = ? AND organization_id = ?
    `).get(id, organizationId) as any;

    return row ? mapFile(row) : undefined;
  }

  read(
    organizationId: string,
    id: string
  ): { metadata: StoredFile; bytes: Buffer } | undefined {
    const row = this.db.prepare(`
      SELECT * FROM enterprise_files
      WHERE id = ? AND organization_id = ?
    `).get(id, organizationId) as any;

    if (!row) return undefined;

    const absolutePath = join(
      this.filesRoot,
      String(row.relative_path)
    );

    if (!existsSync(absolutePath)) {
      return undefined;
    }

    return {
      metadata: mapFile(row),
      bytes: readFileSync(absolutePath)
    };
  }

  delete(
    organizationId: string,
    id: string
  ): boolean {
    const row = this.db.prepare(`
      SELECT relative_path FROM enterprise_files
      WHERE id = ? AND organization_id = ?
    `).get(id, organizationId) as any;

    if (!row) return false;

    const absolutePath = join(
      this.filesRoot,
      String(row.relative_path)
    );

    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
    }

    const result = this.db.prepare(`
      DELETE FROM enterprise_files
      WHERE id = ? AND organization_id = ?
    `).run(id, organizationId);

    return Number(result.changes) > 0;
  }

  private requireMetadata(id: string): StoredFile {
    const row = this.db.prepare(`
      SELECT * FROM enterprise_files WHERE id = ?
    `).get(id) as any;

    if (!row) {
      throw new Error("Stored file metadata missing after write");
    }

    return mapFile(row);
  }
}

function mapFile(row: any): StoredFile {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    appId: row.app_id ? String(row.app_id) : undefined,
    uploadedBy: String(row.uploaded_by),
    name: String(row.name),
    mimeType: String(row.mime_type),
    size: Number(row.size),
    sha256: String(row.sha256),
    createdAt: String(row.created_at)
  };
}

function safeSegment(value: string): string {
  const normalized = value.replace(
    /[^a-zA-Z0-9_.-]/g,
    "_"
  );
  return normalized || "default";
}

function safeExtension(name: string): string {
  const extension = extname(name)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "");
  return extension.length <= 12
    ? extension
    : "";
}

function sanitizeDisplayName(name: string): string {
  const normalized = name
    .replace(/[\r\n\0]/g, " ")
    .trim();
  return (normalized || "file").slice(0, 255);
}
