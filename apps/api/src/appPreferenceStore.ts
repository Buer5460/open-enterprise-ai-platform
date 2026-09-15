import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  runtimeStoragePath
} from "./storagePath.js";

export type AppPreference = {
  organizationId: string;
  memberId: string;
  appId: string;
  favorite: boolean;
  folder?: string;
  lastOpenedAt?: string;
  updatedAt: string;
};

export class AppPreferenceStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    const path = runtimeStoragePath(databasePath);
    mkdirSync(dirname(path), {
      recursive: true
    });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS member_app_preferences (
        organization_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0,
        folder TEXT,
        last_opened_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (organization_id, member_id, app_id)
      );
      CREATE INDEX IF NOT EXISTS idx_app_preferences_recent
        ON member_app_preferences (
          organization_id,
          member_id,
          last_opened_at DESC
        );
    `);

    const columns = new Set(
      (this.db.prepare(
        `PRAGMA table_info(member_app_preferences)`
      ).all() as Array<{ name?: string }>)
        .map((item) => String(item.name ?? ""))
    );

    if (!columns.has("folder")) {
      this.db.exec(`
        ALTER TABLE member_app_preferences
        ADD COLUMN folder TEXT
      `);
    }
  }

  list(
    organizationId: string,
    memberId: string
  ): AppPreference[] {
    return (this.db.prepare(`
      SELECT
        organization_id,
        member_id,
        app_id,
        favorite,
        folder,
        last_opened_at,
        updated_at
      FROM member_app_preferences
      WHERE organization_id = ?
        AND member_id = ?
      ORDER BY
        favorite DESC,
        CASE WHEN last_opened_at IS NULL THEN 1 ELSE 0 END,
        last_opened_at DESC,
        updated_at DESC
    `).all(
      organizationId,
      memberId
    ) as any[]).map(mapPreference);
  }

  get(
    organizationId: string,
    memberId: string,
    appId: string
  ): AppPreference {
    const row = this.db.prepare(`
      SELECT
        organization_id,
        member_id,
        app_id,
        favorite,
        folder,
        last_opened_at,
        updated_at
      FROM member_app_preferences
      WHERE organization_id = ?
        AND member_id = ?
        AND app_id = ?
    `).get(
      organizationId,
      memberId,
      appId
    ) as any;

    return row
      ? mapPreference(row)
      : {
          organizationId,
          memberId,
          appId,
          favorite: false,
          updatedAt: ""
        };
  }

  update(input: {
    organizationId: string;
    memberId: string;
    appId: string;
    favorite?: boolean;
    folder?: string | null;
  }): AppPreference {
    const current = this.get(
      input.organizationId,
      input.memberId,
      input.appId
    );
    const favorite =
      input.favorite ?? current.favorite;
    const folder =
      input.folder === undefined
        ? current.folder ?? null
        : normalizeFolder(input.folder);

    this.db.prepare(`
      INSERT INTO member_app_preferences (
        organization_id,
        member_id,
        app_id,
        favorite,
        folder,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(organization_id, member_id, app_id)
      DO UPDATE SET
        favorite = excluded.favorite,
        folder = excluded.folder,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      input.organizationId,
      input.memberId,
      input.appId,
      favorite ? 1 : 0,
      folder
    );

    return this.get(
      input.organizationId,
      input.memberId,
      input.appId
    );
  }

  setFavorite(input: {
    organizationId: string;
    memberId: string;
    appId: string;
    favorite: boolean;
  }): AppPreference {
    return this.update(input);
  }

  markOpened(input: {
    organizationId: string;
    memberId: string;
    appId: string;
  }): AppPreference {
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO member_app_preferences (
        organization_id,
        member_id,
        app_id,
        favorite,
        last_opened_at,
        updated_at
      ) VALUES (?, ?, ?, 0, ?, ?)
      ON CONFLICT(organization_id, member_id, app_id)
      DO UPDATE SET
        last_opened_at = excluded.last_opened_at,
        updated_at = excluded.updated_at
    `).run(
      input.organizationId,
      input.memberId,
      input.appId,
      now,
      now
    );

    return this.get(
      input.organizationId,
      input.memberId,
      input.appId
    );
  }

  removeApp(
    organizationId: string,
    appId: string
  ): number {
    const result = this.db.prepare(`
      DELETE FROM member_app_preferences
      WHERE organization_id = ?
        AND app_id = ?
    `).run(
      organizationId,
      appId
    );

    return Number(result.changes);
  }
}

function normalizeFolder(
  value: string | null
): string | null {
  if (value === null) return null;

  const normalized = value
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .slice(0, 60);

  return normalized || null;
}

function mapPreference(row: any): AppPreference {
  return {
    organizationId: String(row.organization_id),
    memberId: String(row.member_id),
    appId: String(row.app_id),
    favorite: Boolean(row.favorite),
    folder:
      row.folder == null || !String(row.folder).trim()
        ? undefined
        : String(row.folder),
    lastOpenedAt:
      row.last_opened_at == null
        ? undefined
        : String(row.last_opened_at),
    updatedAt: String(row.updated_at ?? "")
  };
}
