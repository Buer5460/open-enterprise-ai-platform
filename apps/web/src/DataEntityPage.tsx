import React from "react";
import {
  apiFetch,
  apiUrl
} from "./apiClient";

type Field = {
  name: string;
  label?: string;
  type: string;
  required?: boolean;
  options?: string[];
  relationEntity?: string;
  relationDisplayField?: string;
  description?: string;
};

type Entity = {
  name: string;
  description?: string;
  fields?: Field[];
};

type Props = {
  appId: string;
  pageLabel: string;
  entities: Entity[];
};

type RelationOptions = Record<
  string,
  Record<string, unknown>[]
>;

function chooseEntity(
  pageLabel: string,
  entities: Entity[]
): string {
  const label = pageLabel.toLowerCase();
  const rules: Array<[string[], string[]]> = [
    [["客户"], ["customer", "contact"]],
    [["订单"], ["order"]],
    [["线路", "产品"], ["route", "tour"]],
    [["报价"], ["quote"]],
    [["游客"], ["traveler", "tourist", "guest"]],
    [["团期", "库存"], ["group", "inventory", "departure"]],
    [["付款", "收款"], ["payment", "receipt", "transaction"]],
    [["销售", "跟进"], ["lead", "follow", "customer"]]
  ];

  for (const [words, targets] of rules) {
    if (words.some((word) => label.includes(word))) {
      const found = entities.find((entity) =>
        targets.some((target) =>
          entity.name.toLowerCase().includes(target)
        )
      );
      if (found) return found.name;
    }
  }

  return entities[0]?.name ?? "";
}

function fieldKind(type: string): string {
  const value = type.toLowerCase();
  if (value === "attachment" || value.includes("file")) return "attachment";
  if (value === "relation") return "relation";
  if (value === "enum" || value.includes("select")) return "enum";
  if (value === "richtext" || value === "text") return "textarea";
  if (value === "json") return "json";
  if (value.includes("bool")) return "boolean";
  if (value === "currency") return "currency";
  if (value === "integer") return "integer";
  if (value.includes("number") || value.includes("amount") || value.includes("price")) return "number";
  if (value.includes("datetime") || value.includes("timestamp")) return "datetime-local";
  if (value.includes("date")) return "date";
  if (value === "email") return "email";
  if (value === "url") return "url";
  if (value === "phone") return "tel";
  return "text";
}

function toPayloadValue(
  field: Field,
  value: string
): unknown {
  const kind = fieldKind(field.type);

  if (kind === "number" || kind === "currency") {
    return Number(value);
  }

  if (kind === "integer" || kind === "relation") {
    return Number.parseInt(value, 10);
  }

  if (kind === "boolean") {
    return value === "true";
  }

  if (kind === "json") {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(
        `字段「${field.label || field.name}」不是有效 JSON`
      );
    }
  }

  return value;
}

export function DataEntityPage({
  appId,
  pageLabel,
  entities
}: Props) {
  const [entityName, setEntityName] = React.useState(
    chooseEntity(pageLabel, entities)
  );
  const [rows, setRows] = React.useState<
    Record<string, unknown>[]
  >([]);
  const [form, setForm] = React.useState<
    Record<string, string>
  >({});
  const [relationOptions, setRelationOptions] =
    React.useState<RelationOptions>({});
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [editingId, setEditingId] =
    React.useState<number | null>(null);
  const [searchInput, setSearchInput] =
    React.useState("");
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [fieldWorking, setFieldWorking] =
    React.useState<string | null>(null);
  const [message, setMessage] = React.useState("");

  const pageSize = 10;
  const entity = entities.find(
    (item) => item.name === entityName
  );
  const fields = entity?.fields ?? [];
  const visibleFields = fields.slice(0, 6);
  const totalPages = Math.max(
    Math.ceil(total / pageSize),
    1
  );

  const loadRows = React.useCallback(async () => {
    if (!entityName) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      if (query) params.set("q", query);

      const response = await apiFetch(
        apiUrl(
          `/api/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entityName)}?${params.toString()}`
        )
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "加载数据失败"
        );
      }

      setRows(result.rows ?? []);
      setTotal(Number(result.total ?? 0));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "加载数据失败"
      );
    } finally {
      setLoading(false);
    }
  }, [appId, entityName, page, query]);

  const loadRelations = React.useCallback(async () => {
    const relations = fields.filter(
      (field) =>
        fieldKind(field.type) === "relation" &&
        field.relationEntity
    );

    if (relations.length === 0) {
      setRelationOptions({});
      return;
    }

    const next: RelationOptions = {};

    await Promise.all(
      relations.map(async (field) => {
        const response = await apiFetch(
          apiUrl(
            `/api/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(field.relationEntity!) }?page=1&pageSize=100`
          )
        );
        const result = await response
          .json()
          .catch(() => ({}));
        next[field.name] =
          response.ok && result.ok
            ? result.rows ?? []
            : [];
      })
    );

    setRelationOptions(next);
  }, [appId, entityName, fields]);

  React.useEffect(() => {
    void loadRows();
  }, [loadRows]);

  React.useEffect(() => {
    void loadRelations();
  }, [loadRelations]);

  function resetForm() {
    setForm({});
    setEditingId(null);
    setMessage("");
  }

  function setFieldValue(
    fieldName: string,
    value: string
  ) {
    setForm((current) => ({
      ...current,
      [fieldName]: value
    }));
  }

  function startEdit(
    row: Record<string, unknown>
  ) {
    const nextForm: Record<string, string> = {};

    for (const field of fields) {
      const value = row[field.name];

      if (value === null || value === undefined) {
        nextForm[field.name] = "";
      } else if (fieldKind(field.type) === "boolean") {
        nextForm[field.name] =
          Number(value) === 1 ||
          value === true ||
          value === "true"
            ? "true"
            : "false";
      } else {
        nextForm[field.name] = String(value);
      }
    }

    setForm(nextForm);
    setEditingId(Number(row.id));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function uploadAttachment(
    field: Field,
    file: File
  ) {
    setFieldWorking(field.name);
    setMessage(`正在上传 ${file.name}…`);

    try {
      const contentBase64 = await fileToBase64(file);
      const response = await apiFetch(
        apiUrl("/api/files"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: file.name,
            mimeType:
              file.type || "application/octet-stream",
            contentBase64,
            appId
          })
        }
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "附件上传失败"
        );
      }

      setFieldValue(
        field.name,
        JSON.stringify({
          id: result.file.id,
          name: result.file.name,
          mimeType: result.file.mimeType,
          size: result.file.size
        })
      );
      setMessage(`附件「${file.name}」上传完成。`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "附件上传失败"
      );
    } finally {
      setFieldWorking(null);
    }
  }

  async function downloadAttachment(value: unknown) {
    const attachment = parseAttachment(value);
    if (!attachment?.id) return;

    const response = await apiFetch(
      apiUrl(
        `/api/files/${encodeURIComponent(attachment.id)}/content`
      )
    );

    if (!response.ok) {
      setMessage("附件下载失败。");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = attachment.name || "attachment";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function save() {
    if (!entityName) return;

    for (const field of fields) {
      if (field.required && !form[field.name]) {
        setMessage(
          `请填写必填字段：${field.label || field.name}`
        );
        return;
      }
    }

    setSaving(true);
    setMessage("");

    try {
      const payload: Record<string, unknown> = {};

      for (const field of fields) {
        const value = form[field.name];
        if (value === undefined || value === "") continue;
        payload[field.name] = toPayloadValue(field, value);
      }

      const baseUrl = apiUrl(
        `/api/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entityName)}`
      );
      const response = await apiFetch(
        editingId
          ? `${baseUrl}/${editingId}`
          : baseUrl,
        {
          method: editingId ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "保存失败"
        );
      }

      const edited = Boolean(editingId);
      resetForm();
      await loadRows();
      setMessage(edited ? "修改成功" : "保存成功");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "保存失败"
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(
    row: Record<string, unknown>
  ) {
    const id = Number(row.id);
    if (!id) return;

    if (!window.confirm(`确定删除 ID ${id} 这条记录吗？`)) {
      return;
    }

    const response = await apiFetch(
      apiUrl(
        `/api/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entityName)}/${id}`
      ),
      { method: "DELETE" }
    );
    const result = await response.json();

    if (!response.ok || !result.ok) {
      setMessage(result.error ?? "删除失败");
      return;
    }

    if (rows.length === 1 && page > 1) {
      setPage((current) => current - 1);
    } else {
      await loadRows();
    }
    setMessage("记录已删除。");
  }

  return (
    <section className="generatedPage">
      <div className="generatedPageHeader">
        <span className="generatedTag">
          AI GENERATED BUSINESS PAGE
        </span>
        <h2>{pageLabel}</h2>
        <p>
          页面连接真实 SQLite 数据库，支持新增、修改、删除、搜索、分页、附件和关联字段。
        </p>

        <div className="entitySelector">
          <span>数据实体：</span>
          <select
            value={entityName}
            onChange={(event) => {
              setEntityName(event.target.value);
              resetForm();
              setPage(1);
              setQuery("");
              setSearchInput("");
            }}
          >
            {entities.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{
        display: "flex",
        gap: 10,
        marginBottom: 18,
        alignItems: "center"
      }}>
        <input
          value={searchInput}
          placeholder="搜索当前数据实体…"
          onChange={(event) =>
            setSearchInput(event.target.value)
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setPage(1);
              setQuery(searchInput.trim());
            }
          }}
          style={{
            flex: 1,
            maxWidth: 420,
            border: "1px solid #dfe4ec",
            borderRadius: 8,
            padding: "9px 11px"
          }}
        />
        <button
          className="saveButton"
          style={{
            width: "auto",
            marginTop: 0,
            paddingInline: 18
          }}
          onClick={() => {
            setPage(1);
            setQuery(searchInput.trim());
          }}
        >
          搜索
        </button>
        {query && (
          <button
            style={{
              border: "1px solid #dfe4ec",
              background: "white",
              borderRadius: 8,
              padding: "9px 14px",
              cursor: "pointer"
            }}
            onClick={() => {
              setSearchInput("");
              setQuery("");
              setPage(1);
            }}
          >
            清除
          </button>
        )}
      </div>

      {message && (
        <div style={{
          marginBottom: 14,
          padding: "9px 12px",
          borderRadius: 8,
          background: "#f5f8ff",
          color: "#4d5e78",
          fontSize: 12
        }}>
          {message}
        </div>
      )}

      <div className="crudLayout">
        <div className="crudPanel">
          <div className="crudPanelTitle">
            <h3>
              {editingId
                ? `编辑数据 #${editingId}`
                : "新增数据"}
            </h3>
            <span>{entity?.description}</span>
          </div>

          <div className="dynamicForm">
            {fields.map((field) => (
              <FieldEditor
                key={field.name}
                field={field}
                value={form[field.name] ?? ""}
                relationRows={
                  relationOptions[field.name] ?? []
                }
                working={fieldWorking === field.name}
                onChange={(value) =>
                  setFieldValue(field.name, value)
                }
                onAttachment={(file) =>
                  void uploadAttachment(field, file)
                }
                onDownload={() =>
                  void downloadAttachment(
                    form[field.name]
                  )
                }
              />
            ))}
          </div>

          <button
            className="saveButton"
            disabled={saving || Boolean(fieldWorking)}
            onClick={() => void save()}
          >
            {saving
              ? "保存中…"
              : editingId
                ? "✓ 保存修改"
                : "＋ 保存数据"}
          </button>

          {editingId && (
            <button
              style={{
                width: "100%",
                border: "1px solid #dfe4ec",
                background: "white",
                padding: 10,
                borderRadius: 8,
                marginTop: 8,
                cursor: "pointer"
              }}
              onClick={resetForm}
            >
              取消编辑
            </button>
          )}
        </div>

        <div className="crudPanel">
          <div className="crudPanelTitle">
            <h3>数据列表</h3>
            <span>
              共 {total} 条
              {loading ? " · 加载中…" : ""}
            </span>
          </div>

          <div className="dataTableWrap">
            <table className="dataTable">
              <thead>
                <tr>
                  <th>ID</th>
                  {visibleFields.map((field) => (
                    <th key={field.name}>
                      {field.label || field.name}
                    </th>
                  ))}
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)}>
                    <td>{String(row.id ?? "")}</td>
                    {visibleFields.map((field) => (
                      <td key={field.name}>
                        <CellValue
                          field={field}
                          value={row[field.name]}
                          relationRows={
                            relationOptions[field.name] ?? []
                          }
                          onDownload={() =>
                            void downloadAttachment(
                              row[field.name]
                            )
                          }
                        />
                      </td>
                    ))}
                    <td>{String(row.created_at ?? "")}</td>
                    <td>
                      <div style={{
                        display: "flex",
                        gap: 8
                      }}>
                        <button
                          style={{
                            border: 0,
                            background: "transparent",
                            color: "#2563eb",
                            cursor: "pointer"
                          }}
                          onClick={() => startEdit(row)}
                        >
                          编辑
                        </button>
                        <button
                          style={{
                            border: 0,
                            background: "transparent",
                            color: "#dc2626",
                            cursor: "pointer"
                          }}
                          onClick={() => void removeRow(row)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={visibleFields.length + 3}
                      className="noRows"
                    >
                      {query
                        ? "没有找到匹配数据。"
                        : "暂无数据，请先在左侧新增一条记录。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 16,
            fontSize: 13,
            color: "#667085"
          }}>
            <span>第 {page} / {totalPages} 页</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                disabled={page <= 1}
                style={pagerStyle(page <= 1)}
                onClick={() =>
                  setPage((current) =>
                    Math.max(current - 1, 1)
                  )
                }
              >
                上一页
              </button>
              <button
                disabled={page >= totalPages}
                style={pagerStyle(page >= totalPages)}
                onClick={() =>
                  setPage((current) =>
                    Math.min(current + 1, totalPages)
                  )
                }
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FieldEditor(props: {
  field: Field;
  value: string;
  relationRows: Record<string, unknown>[];
  working: boolean;
  onChange: (value: string) => void;
  onAttachment: (file: File) => void;
  onDownload: () => void;
}) {
  const kind = fieldKind(props.field.type);
  const label = props.field.label || props.field.name;
  const attachment = parseAttachment(props.value);

  return (
    <label>
      <span>
        {label}
        {props.field.required ? " *" : ""}
      </span>

      {kind === "boolean" ? (
        <select
          value={props.value || "false"}
          onChange={(event) =>
            props.onChange(event.target.value)
          }
        >
          <option value="false">否</option>
          <option value="true">是</option>
        </select>
      ) : kind === "enum" ? (
        <select
          value={props.value}
          onChange={(event) =>
            props.onChange(event.target.value)
          }
        >
          <option value="">请选择</option>
          {(props.field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : kind === "relation" ? (
        <select
          value={props.value}
          onChange={(event) =>
            props.onChange(event.target.value)
          }
        >
          <option value="">请选择关联记录</option>
          {props.relationRows.map((row) => (
            <option
              key={String(row.id)}
              value={String(row.id)}
            >
              {relationLabel(
                props.field,
                row
              )}
            </option>
          ))}
        </select>
      ) : kind === "textarea" || kind === "json" ? (
        <textarea
          rows={kind === "json" ? 4 : 5}
          value={props.value}
          placeholder={
            kind === "json"
              ? "请输入有效 JSON"
              : props.field.description || label
          }
          onChange={(event) =>
            props.onChange(event.target.value)
          }
          style={{
            width: "100%",
            border: "1px solid #dfe4ec",
            borderRadius: 8,
            padding: "10px 11px",
            font: "inherit",
            resize: "vertical"
          }}
        />
      ) : kind === "attachment" ? (
        <div style={{ display: "grid", gap: 7 }}>
          <input
            type="file"
            disabled={props.working}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) props.onAttachment(file);
              event.currentTarget.value = "";
            }}
          />
          {attachment && (
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "7px 9px",
              background: "#f7f9fc",
              borderRadius: 7,
              fontSize: 11
            }}>
              <span>
                {props.working
                  ? "上传中…"
                  : `📎 ${attachment.name}`}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={props.onDownload}
                >
                  下载
                </button>
                <button
                  type="button"
                  onClick={() => props.onChange("")}
                >
                  移除引用
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <input
          type={
            kind === "currency" ||
            kind === "integer"
              ? "number"
              : kind
          }
          step={
            kind === "currency"
              ? "0.01"
              : kind === "integer"
                ? "1"
                : undefined
          }
          value={props.value}
          placeholder={
            props.field.description ||
            label
          }
          onChange={(event) =>
            props.onChange(event.target.value)
          }
        />
      )}

      {props.field.description && (
        <small style={{
          display: "block",
          marginTop: 4,
          color: "#98a1b1",
          fontSize: 9
        }}>
          {props.field.description}
        </small>
      )}
    </label>
  );
}

function CellValue(props: {
  field: Field;
  value: unknown;
  relationRows: Record<string, unknown>[];
  onDownload: () => void;
}) {
  const kind = fieldKind(props.field.type);

  if (kind === "attachment") {
    const attachment = parseAttachment(props.value);
    return attachment ? (
      <button
        style={{
          border: 0,
          background: "transparent",
          color: "#2563eb",
          cursor: "pointer",
          padding: 0
        }}
        onClick={props.onDownload}
      >
        📎 {attachment.name}
      </button>
    ) : null;
  }

  if (kind === "relation") {
    const id = String(props.value ?? "");
    const row = props.relationRows.find(
      (item) => String(item.id) === id
    );
    return row
      ? relationLabel(props.field, row)
      : id;
  }

  if (kind === "boolean") {
    return Number(props.value) === 1 ||
      props.value === true ||
      props.value === "true"
      ? "是"
      : "否";
  }

  if (kind === "currency") {
    const value = Number(props.value);
    return Number.isFinite(value)
      ? value.toLocaleString("zh-CN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      : String(props.value ?? "");
  }

  const text = String(props.value ?? "");
  return text.length > 80
    ? `${text.slice(0, 80)}…`
    : text;
}

function relationLabel(
  field: Field,
  row: Record<string, unknown>
): string {
  const preferred = field.relationDisplayField;
  if (preferred && row[preferred] != null) {
    return String(row[preferred]);
  }

  for (const candidate of [
    "name",
    "title",
    "displayName",
    "customerName",
    "code"
  ]) {
    if (row[candidate] != null) {
      return String(row[candidate]);
    }
  }

  return `#${String(row.id ?? "")}`;
}

function parseAttachment(value: unknown):
  | { id: string; name: string }
  | undefined {
  if (!value) return undefined;

  try {
    const parsed = typeof value === "string"
      ? JSON.parse(value)
      : value;

    if (
      parsed &&
      typeof parsed === "object" &&
      "id" in parsed &&
      "name" in parsed
    ) {
      return {
        id: String((parsed as any).id),
        name: String((parsed as any).name)
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(
      new Error("无法读取附件")
    );
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const comma = value.indexOf(",");
      resolve(
        comma >= 0
          ? value.slice(comma + 1)
          : value
      );
    };
    reader.readAsDataURL(file);
  });
}

function pagerStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "7px 12px",
    border: "1px solid #dfe4ec",
    background: "white",
    borderRadius: 7,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? .5 : 1
  };
}
