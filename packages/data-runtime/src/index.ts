import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface DataField {
  name: string;
  type: string;
  required?: boolean;
}

export interface DataEntity {
  name: string;
  fields: DataField[];
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
}

function sqlType(type: string): string {
  const value = type.toLowerCase();

  if (value.includes("number") || value.includes("int")) {
    return "REAL";
  }

  if (value.includes("bool")) {
    return "INTEGER";
  }

  return "TEXT";
}

export class AppDatabase {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), {
      recursive: true
    });

    this.db = new DatabaseSync(databasePath);
  }

  ensureEntities(entities: DataEntity[]): void {
    for (const entity of entities) {
      const table = safeName(entity.name);

      const columns = entity.fields.map((field) => {
        return `"${safeName(field.name)}" ${sqlType(field.type)}`;
      });

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS "${table}" (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ${columns.join(",")},
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }
  }

  list(entity: string): unknown[] {
    const table = safeName(entity);

    return this.db
      .prepare(`SELECT * FROM "${table}" ORDER BY id DESC`)
      .all();
  }

  create(
    entity: string,
    data: Record<string, unknown>
  ): unknown {
    const table = safeName(entity);
    const keys = Object.keys(data).map(safeName);
    const values = Object.values(data);

    const sql = `
      INSERT INTO "${table}"
      (${keys.map((key) => `"${key}"`).join(",")})
      VALUES (${keys.map(() => "?").join(",")})
    `;

    const result = this.db
      .prepare(sql)
      .run(...values);

    return this.db
      .prepare(`SELECT * FROM "${table}" WHERE id = ?`)
      .get(result.lastInsertRowid);
  }
}
