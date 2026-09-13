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

type ImportError = {
  row: number;
  field?: string;
  error: string;
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
    Params: { appId: string; entity: string };
    Querystring: { format?: string };
  }>(
    "/api/apps/:appId/data/:entity/export",
    async (request, reply) => {
      const context = await resolveContext(
        request,
        reply,
        request.params.appId,
        request.params.entity,
        "data.read"
      );
      if (!context) return;

      const totalAvailable =
        context.database.count(context.entity.name);
      const rows = readAllRows(
        context.database,
        context.entity.name,
        MAX_EXPORT_ROWS
      );
      const truncated = totalAvailable > rows.length;

      if (request.query.format === "json") {
        return {
          ok: true,
          appId: context.manifest.id,
          entity: context.entity.name,
          total: rows.length,
          totalAvailable,
          truncated,
          rows
        };
      }

      const fields = entityFields(context.entity);
      const csv = toCsv(fields, rows);
      const filename = safeFilename(
        `${context.manifest.displayName ?? context.manifest.name}-${context.entity.name}.csv`
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
      reply.header(
        "X-OEAP-Export-Total",
        String(totalAvailable)
      );
      if (truncated) {
        reply.header("X-OEAP-Export-Truncated", "true");
      }

      return `\uFEFF${csv}`;
    }
  );

  app.post<{
    Params: { appId: string; entity: string };
    Body: ImportBody;
  }>(
    "/api/apps/:appId/data/:entity/import",
    async (request, reply) => {
      const context = await resolveContext(
        request,
        reply,
        request.params.appId,
        request.params.entity,
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
            hasMoreErrors: validation.errors.length > 100,
            preview: validation.rows.slice(0, 20)
          });
      }

      let created: unknown[];
      try {
        created = context.database.createMany(
          context.entity.name,
          validation.rows
        );
      } catch (error) {
        return reply.code(500).send({
          ok: false,
          error:
            `批量导入失败，事务已回滚：${errorMessage(error)}`
        });
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
    request: FastifyRequest,
    reply: FastifyReply,
    appId: string,
    entityName: string,
    permission: "data.read" | "data.write"
  ) {
    const organizationId = organizationFrom(request);
    const memberId = memberFrom(request);

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
          String(item.name) === entityName
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

function entityFields(entity: any): FieldDefinition[] {
  return Array.isArray(entity?.fields)
    ? entity.fields.map((field: any) => ({
        name: String(field.name),
        label:
          typeof field.label === "string"
            ? field.label.trim()
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
    const requested = Math.min(
      100,
      maximum - rows.length
    );
    const page = database.list(entity, {
      limit: requested,
      offset
    }) as Array<Record<string, unknown>>;

    rows.push(...page);
    if (page.length < requested) break;
    offset += page.length;
  }

  return rows;
}

function parseImportRows(
  body: ImportBody,
  fields: FieldDefinition[]
): Array<Record<string, unknown>> {
  if (
    body.format === "json" ||
    (body.format === undefined && Array.isArray(body.rows))
  ) {
    if (!Array.isArray(body.rows)) {
      throw new Error("JSON 导入需要 rows 数组");
    }
    return body.rows.map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error(`JSON 第 ${index + 1} 行必须是对象`);
      }
      return canonicalizeObject(row, fields);
    });
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
    .map((values, rowIndex) => {
      const overflow = values
        .slice(mapping.length)
        .some((value) => value.trim() !== "");
      if (overflow) {
        throw new Error(
          `CSV 第 ${rowIndex + 2} 行包含超出表头的额外列`
        );
      }

      const row: Record<string, unknown> = {};
      for (let index = 0; index < mapping.length; index += 1) {
        const fieldName = mapping[index];
        if (!fieldName || SYSTEM_COLUMNS.has(fieldName)) continue;
        row[fieldName] = values[index] ?? "";
      }
      return row;
    });
}

function canonicalizeObject(
  row: Record<string, unknown>,
  fields: FieldDefinition[]
): Record<string, unknown> {
  const aliases = fieldAliases(fields);
  const result: Record<string, unknown> = {};

  for (const [rawKey, value] of Object.entries(row)) {
    const normalized = rawKey.trim().toLowerCase();

    if (SYSTEM_COLUMNS.has(normalized)) {
      continue;
    }

    const canonical = aliases.get(normalized);
    if (!canonical) {
      result[rawKey] = value;
      continue;
    }

    if (canonical in result) {
      throw new Error(`JSON 导入存在重复字段：${rawKey}`);
    }
    result[canonical] = value;
  }

  return result;
}

function fieldAliases(
  fields: FieldDefinition[]
): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const field of fields) {
    aliases.set(field.name.toLowerCase(), field.name);
    if (field.label) {
      aliases.set(field.label.toLowerCase(), field.name);
    }
  }

  return aliases;
}

function mapHeaders(
  headers: string[],
  fields: FieldDefinition[]
): string[] {
  const aliases = fieldAliases(fields);
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
): {
  rows: Array<Record<string, unknown>>;
  errors: ImportError[];
} {
  const fieldMap = new Map(
    fields.map((field) => [field.name, field])
  );
  const rows: Array<Record<string, unknown>> = [];
  const errors: ImportError[] = [];

  source.forEach((input, index) => {
    const line = index + 1;
    const before = errors.length;
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

    if (errors.length === before) {
      rows.push(normalized);
    }
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
    throw new Error(
      `${field.label ?? field.name} 必须是 true/false、1/0 或 是/否`
    );
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
    if (typeof raw === "object" && raw !== null) {
      return raw;
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `${field.label ?? field.name} 不是有效 JSON`
      );
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
  fields: FieldDefinition[],
  rows: Array<Record<string, unknown>>
): string {
  const labels = fields.map((field) =>
    field.label || field.name
  );
  const normalizedLabels = labels.map((label) =>
    label.trim().toLowerCase()
  );
  const useLabels =
    new Set(normalizedLabels).size === normalizedLabels.length;

  const headers = [
    "id",
    ...fields.map((field) =>
      useLabels ? field.label || field.name : field.name
    ),
    "created_at",
    "updated_at"
  ];

  const lines = [
    headers.map(csvCell).join(",")
  ];

  for (const row of rows) {
    const cells: unknown[] = [
      row.id,
      ...fields.map((field) =>
        safeSpreadsheetValue(
          row[field.name],
          field.type
        )
      ),
      row.created_at,
      row.updated_at
    ];
    lines.push(cells.map(csvCell).join(","));
  }

  return lines.join("\r\n");
}

function safeSpreadsheetValue(
  value: unknown,
  fieldType: string
): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const type = fieldType.toLowerCase();
  const numeric = [
    "number",
    "integer",
    "currency",
    "relation"
  ].includes(type);

  if (!numeric && /^[\t\r\n ]*[=+\-@]/.test(value)) {
    return `'${value}`;
  }

  return value;
}

function csvCell(value: unknown): string {
  const text = exportValue(value);
  return /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function exportValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
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
