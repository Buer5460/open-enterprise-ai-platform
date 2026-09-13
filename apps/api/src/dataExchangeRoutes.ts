import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

import {
  AppDatabase
} from "@oeap/data-runtime";

import {
  runtimePath
} from "./runtimePaths.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";
import {
  TenancyStore
} from "./tenancyStore.js";

export interface DataExchangeRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
  loadApps: (organizationId?: string) => Promise<any[]>;
}

type FieldDefinition = {
  name: string;
  label?: string;
  type: string;
  required?: boolean;
  options?: string[];
};

type ImportBody = {
  format?: "csv" | "json";
  csv?: string;
  rows?: Array<Record<string, unknown>>;
  dryRun?: boolean;
};

const MAX_IMPORT_ROWS = 2_000;
const MAX_EXPORT_ROWS = 5_000;
const SYSTEM_COLUMNS = new Set([
  "id",
  "created_at",
  "updated_at"
]);

export function registerDataExchangeRoutes(
  options: DataExchangeRoutesOptions
) {
  const {
    app,
    repoRoot,
    loadApps
  } = options;

  const tenancy = new TenancyStore(
    runtimePath(repoRoot, "tenancy", "tenancy.sqlite")
  );

  app.get<{
    Params: {
      appId: string;
      entity: string;
    };
    Querystring: {
      format?: string;
    };
  }>(
    "/api/apps/:appId/data/:entity/export",
    async (request, reply) => {
      const context = await resolveContext(
        request,
        reply,
        "data.read"
      );
      if (!context) return;

      const { manifest, database, entity } = context;
      const rows = readAllRows(
        database,
        entity.name,
        MAX_EXPORT_ROWS
      );
      const format =
        request.query.format === "json"
          ? "json"
          : "csv";

      if (format === "json") {
        return {
          ok: true,
          appId: manifest.id,
          entity: entity.name,
          total: rows.length,
          truncated:
            database.count(entity.name) > rows.length,
          rows
        };
      }

      const fields = entityFields(entity);
      const columns = [
        "id",
        ...fields.map((field) => field.name),
        "created_at",
        "updated_at"
      ];
      const csv = toCsv(columns, rows);
      const filename = safeFilename(
        `${manifest.displayName ?? manifest.name}-${entity.name}.csv`
      );

      reply.header(
        "Content-Type",
        "text/csv; charset=utf-8"
      );
      reply.header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      reply.header(
        "X-OEAP-Export-Rows",
        String(rows.length)
      );
      if (database.count(entity.name) > rows.length) {
        reply.header("X-OEAP-Export-Truncated", "true");
      }
      return `\uFEFF${csv}`;
    }
  );

  app.post<{
    Params: {
      appId: string;
      entity: string;
    };
    Body: ImportBody;
  }>(
    "/api/apps/:appId/data/:entity/import",
    async (request, reply) => {
      const context = await resolveContext(
        request,
        reply,
        "data.write"
      );
      if (!context) return;

      const fields = entityFields(context.entity);
      let sourceRows: Array<Record<string, unknown>>;

      try {
        sourceRows = parseImportRows(
          request.body ?? {},
          fields
        );
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error: errorMessage(error)
        });
      }

      if (sourceRows.length === 0) {
        return reply.code(400).send({
          ok: false,
          error: "导入文件没有可处理的数据行"
        });
      }

      if (sourceRows.length > MAX_IMPORT_ROWS) {
        return reply.code(413).send({
          ok: false,
          error:
            `单次最多导入 ${MAX_IMPORT_ROWS} 行，当前为 ${sourceRows.length} 行`
        });
      }

      const validation = validateRows(
        sourceRows,
        fields
      );

      if (
        request.body?.dryRun ||
        validation.errors.length > 0
      ) {
        return reply
          .code(validation.errors.length > 0 ? 422 : 200)
          .send({
            ok: validation.errors.length === 0,
            dryRun: true,
            totalRows: sourceRows.length,
            validRows: validation.rows.length,
            errorCount: validation.errors.length,
            errors: validation.errors.slice(0, 100),
            preview: validation.rows.slice(0, 20)
          });
      }

      const created: unknown[] = [];
      for (const row of validation.rows) {
        created.push(
          context.database.create(
            context.entity.name,
            row
          )
        );
      }

      return {
        ok: true,
        dryRun: false,
        imported: created.length,
        total:
          context.database.count(
            context.entity.name
          ),
        preview: created.slice(0, 20)
      };
    }
  );

  async function resolveContext(
    request: FastifyRequest<{
      Params: {
        appId: string;
        entity: string;
      };
    }>,
    reply: FastifyReply,
    permission: "data.read" | "data.write"
  ) {
    const organizationId = organizationFrom(request);
    const memberId = memberFrom(request);
    const appId = request.params.appId;

    if (!can(
      tenancy,
      organizationId,
      memberId,
      permission,
      appId
    )) {
      reply.code(403).send({
        ok: false,
        error: "Forbidden"
      });
      return undefined;
    }

    const manifest = (await loadApps(organizationId))
      .find((item) => item.id === appId);
    if (!manifest) {
      reply.code(404).send({
        ok: false,
        error: "App not found"
      });
      return undefined;
    }

    const entity = (manifest.metadata?.entities ?? [])
      .find(
        (item: any) =>
          String(item.name) === request.params.entity
      );
    if (!entity) {
      reply.code(404).send({
        ok: false,
        error: "Entity not found"
      });
      return undefined;
    }

    const database = appDatabase(
      repoRoot,
      organizationId,
      manifest
    );

    return {
      manifest,
      entity,
      database
    };
  }
}

function appDatabase(
  repoRoot: string,
  organizationId: string,
  manifest: any
): AppDatabase {
  const safeAppId = safeIdentifier(manifest.id);
  const safeOrgId = safeIdentifier(organizationId);
  const filename =
    organizationId === "org_local"
      ? `${safeAppId}.sqlite`
      : `${safeOrgId}__${safeAppId}.sqlite`;
  const database = new AppDatabase(
    runtimePath(repoRoot, "databases", filename)
  );

  database.ensureEntities(
    (manifest.metadata?.entities ?? []).map(
      (entity: any) => ({
        name: entity.name,
        fields: entity.fields ?? []
      })
    )
  );
  return database;
}

function entityFields(
  entity: any
): FieldDefinition[] {
  return Array.isArray(entity?.fields)
    ? entity.fields.map((field: any) => ({
        name: String(field.name),
        label:
          typeof field.label === "string"
            ? field.label
            : undefined,
        type: String(field.type ?? "string"),
        required: Boolean(field.required),
        options: Array.isArray(field.options)
          ? field.options.map(String)
          : undefined
      }))
    : [];
}

function readAllRows(
  database: AppDatabase,
  entity: string,
  maximum: number
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  let offset = 0;

  while (rows.length < maximum) {
    const page = database.list(entity, {
      limit: Math.min(100, maximum - rows.length),
      offset
    }) as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < 100) break;
    offset += page.length;
  }

  return rows;
}

function parseImportRows(
  body: ImportBody,
  fields: FieldDefinition[]
): Array<Record<string, unknown>> {
  if (body.format === "json") {
    if (!Array.isArray(body.rows)) {
      throw new Error("JSON 导入需要 rows 数组");
    }
    return body.rows;
  }

  if (typeof body.csv !== "string") {
    throw new Error("CSV 导入需要 csv 文本");
  }

  const matrix = parseCsv(body.csv);
  if (matrix.length < 2) return [];

  const rawHeaders = matrix[0].map((value) =>
    value.replace(/^\uFEFF/, "").trim()
  );
  const mapping = mapHeaders(
    rawHeaders,
    fields
  );

  return matrix
    .slice(1)
    .filter((values) =>
      values.some((value) => value.trim() !== "")
    )
    .map((values) => {
      const row: Record<string, unknown> = {};
      for (let index = 0; index < mapping.length; index += 1) {
        const fieldName = mapping[index];
        if (!fieldName || SYSTEM_COLUMNS.has(fieldName)) continue;
        row[fieldName] = values[index] ?? "";
      }
      return row;
    });
}

function mapHeaders(
  headers: string[],
  fields: FieldDefinition[]
): string[] {
  const aliases = new Map<string, string>();
  for (const field of fields) {
    aliases.set(field.name.toLowerCase(), field.name);
    if (field.label?.trim()) {
      aliases.set(field.label.trim().toLowerCase(), field.name);
    }
  }
  for (const system of SYSTEM_COLUMNS) {
    aliases.set(system, system);
  }

  const mapped = headers.map((header) => {
    const normalized = header.trim().toLowerCase();
    const value = aliases.get(normalized);
    if (!value) {
      throw new Error(`未知导入列：${header}`);
    }
    return value;
  });

  const business = mapped.filter(
    (value) => !SYSTEM_COLUMNS.has(value)
  );
  if (new Set(business).size !== business.length) {
    throw new Error("导入文件存在重复字段列");
  }
  return mapped;
}

function validateRows(
  source: Array<Record<string, unknown>>,
  fields: FieldDefinition[]
) {
  const fieldMap = new Map(
    fields.map((field) => [field.name, field])
  );
  const rows: Array<Record<string, unknown>> = [];
  const errors: Array<{
    row: number;
    field?: string;
    error: string;
  }> = [];

  source.forEach((input, index) => {
    const line = index + 2;
    const normalized: Record<string, unknown> = {};

    for (const key of Object.keys(input)) {
      if (SYSTEM_COLUMNS.has(key)) continue;
      if (!fieldMap.has(key)) {
        errors.push({
          row: line,
          field: key,
          error: `未知字段：${key}`
        });
      }
    }

    for (const field of fields) {
      const raw = input[field.name];
      const empty =
        raw === undefined ||
        raw === null ||
        (typeof raw === "string" && raw.trim() === "");

      if (empty) {
        if (field.required) {
          errors.push({
            row: line,
            field: field.name,
            error: `${field.label ?? field.name} 为必填字段`
          });
        }
        continue;
      }

      try {
        normalized[field.name] = normalizeValue(
          field,
          raw
        );
      } catch (error) {
        errors.push({
          row: line,
          field: field.name,
          error: errorMessage(error)
        });
      }
    }

    rows.push(normalized);
  });

  return { rows, errors };
}

function normalizeValue(
  field: FieldDefinition,
  raw: unknown
): unknown {
  const type = field.type.toLowerCase();
  const text =
    typeof raw === "string"
      ? raw.trim()
      : String(raw);

  if (
    type === "currency" ||
    type === "number" ||
    type.includes("amount") ||
    type.includes("price")
  ) {
    const value = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(value)) {
      throw new Error(`${field.label ?? field.name} 必须是数字`);
    }
    return value;
  }

  if (type === "integer") {
    if (!/^-?\d+$/.test(text)) {
      throw new Error(`${field.label ?? field.name} 必须是整数`);
    }
    return Number.parseInt(text, 10);
  }

  if (type === "relation") {
    if (!/^\d+$/.test(text)) {
      throw new Error(`${field.label ?? field.name} 必须填写关联记录 ID`);
    }
    return Number.parseInt(text, 10);
  }

  if (type.includes("bool")) {
    const trueValues = new Set([
      "true", "1", "yes", "y", "是"
    ]);
    const falseValues = new Set([
      "false", "0", "no", "n", "否"
    ]);
    const lower = text.toLowerCase();
    if (trueValues.has(lower)) return true;
    if (falseValues.has(lower)) return false;
    throw new Error(`${field.label ?? field.name} 必须是 true/false、1/0 或 是/否`);
  }

  if (type === "enum" && field.options?.length) {
    if (!field.options.includes(text)) {
      throw new Error(
        `${field.label ?? field.name} 只能是：${field.options.join("、")}`
      );
    }
    return text;
  }

  if (type === "json") {
    if (typeof raw === "object") return raw;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${field.label ?? field.name} 不是有效 JSON`);
    }
  }

  return typeof raw === "string"
    ? text
    : raw;
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (quoted) {
    throw new Error("CSV 引号未闭合");
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function toCsv(
  columns: string[],
  rows: Array<Record<string, unknown>>
): string {
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) =>
      columns.map((column) =>
        csvCell(exportValue(row[column]))
      ).join(",")
    )
  ].join("\r\n");
}

function exportValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function safeFilename(value: string): string {
  return value.replace(
    /[\\/:*?"<>|\r\n]+/g,
    "_"
  );
}

function safeIdentifier(value: unknown): string {
  return String(value).replace(
    /[^A-Za-z0-9_.-]/g,
    "_"
  );
}

function can(
  tenancy: TenancyStore,
  organizationId: string,
  memberId: string,
  permission: string,
  appId?: string
): boolean {
  try {
    return tenancy.authorize({
      organizationId,
      memberId,
      permission,
      appId
    });
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Data exchange failed";
}
