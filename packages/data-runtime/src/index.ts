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

export interface ListOptions {
  query?: string;
  limit?: number;
  offset?: number;
}

type DBValue =
  | string
  | number
  | bigint
  | null;

function safeName(value: string): string {
  const normalized = value.replace(
    /[^a-zA-Z0-9_]/g,
    "_"
  );

  if (!normalized) {
    throw new Error("Invalid database identifier");
  }

  return normalized;
}

function sqlType(type: string): string {
  const value = type.toLowerCase();

  if (
    value.includes("number") ||
    value.includes("int") ||
    value.includes("amount") ||
    value.includes("price")
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

      const declaredColumns =
        entity.fields.map(
          (field) =>
            `"${safeName(field.name)}" ${sqlType(field.type)}`
        );

      const optionalColumnsSql =
        declaredColumns.length > 0
          ? `,\n${declaredColumns.join(",\n")}`
          : "";

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS "${table}" (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          ${optionalColumnsSql}
        )
      `);

      const existingColumns =
        new Set(
          this.getAllColumns(table)
        );

      for (const field of entity.fields) {
        const column =
          safeName(field.name);

        if (existingColumns.has(column)) {
          continue;
        }

        this.db.exec(`
          ALTER TABLE "${table}"
          ADD COLUMN "${column}" ${sqlType(field.type)}
        `);

        existingColumns.add(column);
      }
    }
  }

  list(
    entity: string,
    options: ListOptions = {}
  ): unknown[] {
    const table =
      safeName(entity);

    const limit = Math.min(
      Math.max(options.limit ?? 20, 1),
      100
    );

    const offset = Math.max(
      options.offset ?? 0,
      0
    );

    const query =
      options.query?.trim();

    const searchableColumns =
      this.getSearchableColumns(table);

    const where =
      query && searchableColumns.length > 0
        ? `WHERE ${searchableColumns
            .map(
              (column) =>
                `CAST("${column}" AS TEXT) LIKE ?`
            )
            .join(" OR ")}`
        : "";

    const params: DBValue[] =
      query
        ? searchableColumns.map(
            () => `%${query}%`
          )
        : [];

    return this.db
      .prepare(`
        SELECT * FROM "${table}"
        ${where}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `)
      .all(
        ...params,
        limit,
        offset
      );
  }

  count(
    entity: string,
    query?: string
  ): number {
    const table =
      safeName(entity);

    const normalizedQuery =
      query?.trim();

    const searchableColumns =
      this.getSearchableColumns(table);

    const where =
      normalizedQuery && searchableColumns.length > 0
        ? `WHERE ${searchableColumns
            .map(
              (column) =>
                `CAST("${column}" AS TEXT) LIKE ?`
            )
            .join(" OR ")}`
        : "";

    const params: DBValue[] =
      normalizedQuery
        ? searchableColumns.map(
            () => `%${normalizedQuery}%`
          )
        : [];

    const row = this.db
      .prepare(`
        SELECT COUNT(*) AS total
        FROM "${table}"
        ${where}
      `)
      .get(...params) as
      | { total: number }
      | undefined;

    return Number(row?.total ?? 0);
  }

  get(
    entity: string,
    id: number
  ): unknown {
    const table =
      safeName(entity);

    return this.db
      .prepare(
        `SELECT * FROM "${table}" WHERE id = ?`
      )
      .get(id);
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

    return this.get(
      entity,
      Number(result.lastInsertRowid)
    );
  }

  update(
    entity: string,
    id: number,
    data: Record<string, unknown>
  ): unknown {
    const table =
      safeName(entity);

    const entries =
      Object.entries(data);

    if (entries.length === 0) {
      throw new Error(
        "No data supplied"
      );
    }

    const assignments =
      entries
        .map(
          ([key]) =>
            `"${safeName(key)}" = ?`
        )
        .join(", ");

    const values: DBValue[] =
      entries.map(
        ([, value]) =>
          toDBValue(value)
      );

    this.db
      .prepare(`
        UPDATE "${table}"
        SET ${assignments},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(
        ...values,
        id
      );

    return this.get(
      entity,
      id
    );
  }

  delete(
    entity: string,
    id: number
  ): boolean {
    const table =
      safeName(entity);

    const result =
      this.db
        .prepare(
          `DELETE FROM "${table}" WHERE id = ?`
        )
        .run(id);

    return Number(result.changes) > 0;
  }

  private getAllColumns(
    table: string
  ): string[] {
    const columns = this.db
      .prepare(
        `PRAGMA table_info("${table}")`
      )
      .all() as Array<{
        name?: string;
      }>;

    return columns
      .map((column) =>
        safeName(
          String(column.name ?? "")
        )
      )
      .filter(Boolean);
  }

  private getSearchableColumns(
    table: string
  ): string[] {
    return this.getAllColumns(table)
      .filter(
        (column) =>
          ![
            "id",
            "created_at",
            "updated_at"
          ].includes(column)
      );
  }
}
