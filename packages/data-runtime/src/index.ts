import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface DataField {
  name: string;
  type: string;
  required?: boolean;
  options?: string[];
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

export class DataValidationError extends Error {
  readonly code = "DATA_VALIDATION_ERROR";

  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = "DataValidationError";
  }
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
    value.includes("price") ||
    value === "currency" ||
    value === "relation"
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
  private readonly definitions =
    new Map<string, DataEntity>();

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

      this.definitions.set(
        table,
        {
          name: entity.name,
          fields: entity.fields.map((field) => ({
            name: field.name,
            type: field.type,
            required: Boolean(field.required),
            options: Array.isArray(field.options)
              ? [...field.options]
              : undefined
          }))
        }
      );

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
    const normalized =
      this.validateData(table, data, true);

    const keys = Object.keys(normalized);

    if (keys.length === 0) {
      throw new DataValidationError(
        "No data supplied"
      );
    }

    const values: DBValue[] =
      Object.values(normalized).map(
        toDBValue
      );

    const sql = `
      INSERT INTO "${table}"
      (${keys
        .map((key) => `"${safeName(key)}"`)
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

  createMany(
    entity: string,
    rows: Array<Record<string, unknown>>
  ): unknown[] {
    if (rows.length === 0) {
      return [];
    }

    this.db.exec("BEGIN IMMEDIATE");

    try {
      const created = rows.map((row) =>
        this.create(entity, row)
      );
      this.db.exec("COMMIT");
      return created;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original insertion error.
      }
      throw error;
    }
  }

  update(
    entity: string,
    id: number,
    data: Record<string, unknown>
  ): unknown {
    const table =
      safeName(entity);
    const normalized =
      this.validateData(table, data, false);
    const entries =
      Object.entries(normalized);

    if (entries.length === 0) {
      throw new DataValidationError(
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

  private validateData(
    table: string,
    data: Record<string, unknown>,
    creating: boolean
  ): Record<string, unknown> {
    const definition = this.definitions.get(table);

    if (!definition) {
      throw new DataValidationError(
        `Entity schema is not registered: ${table}`
      );
    }

    const fields = new Map(
      definition.fields.map((field) => [
        safeName(field.name),
        field
      ])
    );

    for (const key of Object.keys(data)) {
      const normalizedKey = safeName(key);
      if (!fields.has(normalizedKey)) {
        throw new DataValidationError(
          `Unknown field: ${key}`,
          key
        );
      }
    }

    if (creating) {
      for (const field of definition.fields) {
        if (!field.required) continue;
        const value = data[field.name];
        if (isEmpty(value)) {
          throw new DataValidationError(
            `${field.name} is required`,
            field.name
          );
        }
      }
    }

    const normalized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      const field = fields.get(safeName(key))!;

      if (!creating && field.required && isEmpty(value)) {
        throw new DataValidationError(
          `${field.name} cannot be empty`,
          field.name
        );
      }

      if (value === undefined) {
        continue;
      }

      normalized[field.name] =
        normalizeFieldValue(field, value);
    }

    return normalized;
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

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
}

function normalizeFieldValue(
  field: DataField,
  value: unknown
): unknown {
  if (value === null) {
    return null;
  }

  const type = field.type.toLowerCase();
  const text =
    typeof value === "string"
      ? value.trim()
      : String(value);

  if (
    type === "number" ||
    type === "currency" ||
    type.includes("amount") ||
    type.includes("price")
  ) {
    const number =
      typeof value === "number"
        ? value
        : Number(text.replace(/,/g, ""));

    if (!Number.isFinite(number)) {
      throw new DataValidationError(
        `${field.name} must be a number`,
        field.name
      );
    }

    return number;
  }

  if (type === "integer" || type === "relation") {
    const number =
      typeof value === "number"
        ? value
        : Number(text);

    if (!Number.isInteger(number)) {
      throw new DataValidationError(
        `${field.name} must be an integer`,
        field.name
      );
    }

    return number;
  }

  if (type.includes("bool")) {
    if (typeof value === "boolean") {
      return value;
    }

    if (value === 1 || value === 0) {
      return value === 1;
    }

    const lower = text.toLowerCase();
    if (["true", "1", "yes", "y", "是"].includes(lower)) {
      return true;
    }
    if (["false", "0", "no", "n", "否"].includes(lower)) {
      return false;
    }

    throw new DataValidationError(
      `${field.name} must be a boolean`,
      field.name
    );
  }

  if (type === "enum" && field.options?.length) {
    if (!field.options.includes(text)) {
      throw new DataValidationError(
        `${field.name} must be one of: ${field.options.join(", ")}`,
        field.name
      );
    }

    return text;
  }

  if (type === "json") {
    if (typeof value === "object") {
      return value;
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new DataValidationError(
        `${field.name} must be valid JSON`,
        field.name
      );
    }
  }

  return typeof value === "string"
    ? text
    : value;
}
