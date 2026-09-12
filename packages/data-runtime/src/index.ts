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

type DBValue =
  | string
  | number
  | bigint
  | null;

function safeName(value: string): string {
  return value.replace(
    /[^a-zA-Z0-9_]/g,
    "_"
  );
}

function sqlType(type: string): string {
  const value = type.toLowerCase();

  if (
    value.includes("number") ||
    value.includes("int")
  ) {
    return "REAL";
  }

  if (value.includes("bool")) {
    return "INTEGER";
  }

  return "TEXT";
}

function toDBValue(value: unknown): DBValue {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  return JSON.stringify(value);
}

export class AppDatabase {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(
      dirname(databasePath),
      { recursive: true }
    );

    this.db =
      new DatabaseSync(databasePath);
  }

  ensureEntities(
    entities: DataEntity[]
  ): void {
    for (const entity of entities) {
      const table =
        safeName(entity.name);

      const columns =
        entity.fields.map(
          (field) =>
            `"${safeName(field.name)}" ${sqlType(field.type)}`
        );

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
    const table =
      safeName(entity);

    return this.db
      .prepare(
        `SELECT * FROM "${table}" ORDER BY id DESC`
      )
      .all();
  }

  create(
    entity: string,
    data: Record<string, unknown>
  ): unknown {
    const table =
      safeName(entity);

    const keys =
      Object.keys(data).map(
        safeName
      );

    if (keys.length === 0) {
      throw new Error(
        "No data supplied"
      );
    }

    const values: DBValue[] =
      Object.values(data).map(
        toDBValue
      );

    const sql = `
      INSERT INTO "${table}"
      (${keys
        .map((key) => `"${key}"`)
        .join(",")})
      VALUES
      (${keys
        .map(() => "?")
        .join(",")})
    `;

    const result =
      this.db
        .prepare(sql)
        .run(...values);

    return this.db
      .prepare(
        `SELECT * FROM "${table}" WHERE id = ?`
      )
      .get(
        result.lastInsertRowid
      );
  }
}
