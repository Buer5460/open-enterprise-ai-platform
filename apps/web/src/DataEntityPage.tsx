import React from "react";

type Field = {
  name: string;
  type: string;
  required?: boolean;
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

function chooseEntity(
  pageLabel: string,
  entities: Entity[]
): string {
  const label =
    pageLabel.toLowerCase();

  const rules: Array<
    [string[], string[]]
  > = [
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
    if (
      words.some((word) =>
        label.includes(word)
      )
    ) {
      const found =
        entities.find((entity) =>
          targets.some((target) =>
            entity.name
              .toLowerCase()
              .includes(target)
          )
        );

      if (found) {
        return found.name;
      }
    }
  }

  return entities[0]?.name ?? "";
}

function fieldKind(type: string) {
  const value = type.toLowerCase();

  if (value.includes("bool")) {
    return "boolean";
  }

  if (
    value.includes("number") ||
    value.includes("int") ||
    value.includes("amount") ||
    value.includes("price")
  ) {
    return "number";
  }

  if (
    value.includes("datetime") ||
    value.includes("timestamp")
  ) {
    return "datetime-local";
  }

  if (value.includes("date")) {
    return "date";
  }

  return "text";
}

function toPayloadValue(
  field: Field,
  value: string
): unknown {
  const kind = fieldKind(field.type);

  if (kind === "number") {
    return Number(value);
  }

  if (kind === "boolean") {
    return value === "true";
  }

  return value;
}

export function DataEntityPage({
  appId,
  pageLabel,
  entities
}: Props) {
  const [entityName, setEntityName] =
    React.useState(
      chooseEntity(
        pageLabel,
        entities
      )
    );

  const [rows, setRows] =
    React.useState<
      Record<string, unknown>[]
    >([]);

  const [form, setForm] =
    React.useState<
      Record<string, string>
    >({});

  const [saving, setSaving] =
    React.useState(false);

  const [loading, setLoading] =
    React.useState(false);

  const [editingId, setEditingId] =
    React.useState<number | null>(null);

  const [searchInput, setSearchInput] =
    React.useState("");

  const [query, setQuery] =
    React.useState("");

  const [page, setPage] =
    React.useState(1);

  const [total, setTotal] =
    React.useState(0);

  const pageSize = 10;

  const entity =
    entities.find(
      (item) =>
        item.name === entityName
    );

  const fields =
    entity?.fields ?? [];

  const visibleFields =
    fields.slice(0, 6);

  const totalPages =
    Math.max(
      Math.ceil(total / pageSize),
      1
    );

  const loadRows = React.useCallback(
    async () => {
      if (!entityName) {
        return;
      }

      setLoading(true);

      try {
        const params =
          new URLSearchParams({
            page: String(page),
            pageSize: String(pageSize)
          });

        if (query) {
          params.set("q", query);
        }

        const response =
          await fetch(
            `http://127.0.0.1:8787/api/apps/${encodeURIComponent(
              appId
            )}/data/${encodeURIComponent(
              entityName
            )}?${params.toString()}`
          );

        const result =
          await response.json();

        if (!response.ok || !result.ok) {
          throw new Error(
            result.error ??
            "加载数据失败"
          );
        }

        setRows(
          result.rows ?? []
        );

        setTotal(
          Number(result.total ?? 0)
        );
      } catch (error) {
        alert(
          error instanceof Error
            ? error.message
            : "加载数据失败"
        );
      } finally {
        setLoading(false);
      }
    },
    [
      appId,
      entityName,
      page,
      query
    ]
  );

  React.useEffect(() => {
    void loadRows();
  }, [loadRows]);

  function resetForm() {
    setForm({});
    setEditingId(null);
  }

  function startEdit(
    row: Record<string, unknown>
  ) {
    const nextForm:
      Record<string, string> = {};

    for (const field of fields) {
      const value =
        row[field.name];

      if (
        value === null ||
        value === undefined
      ) {
        nextForm[field.name] = "";
      } else if (
        fieldKind(field.type) === "boolean"
      ) {
        nextForm[field.name] =
          Number(value) === 1 ||
          value === true ||
          value === "true"
            ? "true"
            : "false";
      } else {
        nextForm[field.name] =
          String(value);
      }
    }

    setForm(nextForm);
    setEditingId(
      Number(row.id)
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  async function save() {
    if (!entityName) {
      return;
    }

    for (const field of fields) {
      if (
        field.required &&
        !form[field.name]
      ) {
        alert(
          `请填写必填字段：${field.name}`
        );
        return;
      }
    }

    setSaving(true);

    try {
      const payload:
        Record<string, unknown> =
        {};

      for (const field of fields) {
        const value =
          form[field.name];

        if (
          value === undefined ||
          value === ""
        ) {
          continue;
        }

        payload[field.name] =
          toPayloadValue(
            field,
            value
          );
      }

      const baseUrl =
        `http://127.0.0.1:8787/api/apps/${encodeURIComponent(
          appId
        )}/data/${encodeURIComponent(
          entityName
        )}`;

      const response =
        await fetch(
          editingId
            ? `${baseUrl}/${editingId}`
            : baseUrl,
          {
            method:
              editingId
                ? "PUT"
                : "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body:
              JSON.stringify(payload)
          }
        );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.ok
      ) {
        throw new Error(
          result.error ??
          "保存失败"
        );
      }

      resetForm();
      await loadRows();

      alert(
        editingId
          ? "修改成功"
          : "保存成功"
      );
    } catch (error) {
      alert(
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

    if (!id) {
      return;
    }

    if (
      !window.confirm(
        `确定删除 ID ${id} 这条记录吗？`
      )
    ) {
      return;
    }

    const response =
      await fetch(
        `http://127.0.0.1:8787/api/apps/${encodeURIComponent(
          appId
        )}/data/${encodeURIComponent(
          entityName
        )}/${id}`,
        {
          method: "DELETE"
        }
      );

    const result =
      await response.json();

    if (!response.ok || !result.ok) {
      alert(
        result.error ??
        "删除失败"
      );
      return;
    }

    if (
      rows.length === 1 &&
      page > 1
    ) {
      setPage(
        (current) => current - 1
      );
    } else {
      await loadRows();
    }
  }

  return (
    <section className="generatedPage">
      <div className="generatedPageHeader">
        <span className="generatedTag">
          AI GENERATED BUSINESS PAGE
        </span>

        <h2>{pageLabel}</h2>

        <p>
          当前页面已经连接到真实 SQLite 数据库，并支持新增、修改、删除、搜索和分页。
        </p>

        <div className="entitySelector">
          <span>数据实体：</span>

          <select
            value={entityName}
            onChange={(event) => {
              setEntityName(
                event.target.value
              );
              resetForm();
              setPage(1);
              setQuery("");
              setSearchInput("");
            }}
          >
            {entities.map(
              (item) => (
                <option
                  key={item.name}
                  value={item.name}
                >
                  {item.name}
                </option>
              )
            )}
          </select>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 18,
          alignItems: "center"
        }}
      >
        <input
          value={searchInput}
          placeholder="搜索当前数据实体…"
          onChange={(event) =>
            setSearchInput(
              event.target.value
            )
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setPage(1);
              setQuery(
                searchInput.trim()
              );
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
            setQuery(
              searchInput.trim()
            );
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

      <div className="crudLayout">
        <div className="crudPanel">
          <div className="crudPanelTitle">
            <h3>
              {editingId
                ? `编辑数据 #${editingId}`
                : "新增数据"}
            </h3>
            <span>
              {entity?.description}
            </span>
          </div>

          <div className="dynamicForm">
            {fields.map(
              (field) => {
                const kind =
                  fieldKind(field.type);

                return (
                  <label
                    key={field.name}
                  >
                    <span>
                      {field.name}
                      {field.required
                        ? " *"
                        : ""}
                    </span>

                    {kind === "boolean" ? (
                      <select
                        value={
                          form[field.name] ?? "false"
                        }
                        onChange={(event) =>
                          setForm(
                            (current) => ({
                              ...current,
                              [field.name]:
                                event.target.value
                            })
                          )
                        }
                      >
                        <option value="false">
                          否
                        </option>
                        <option value="true">
                          是
                        </option>
                      </select>
                    ) : (
                      <input
                        type={kind}
                        value={
                          form[
                            field.name
                          ] ?? ""
                        }
                        placeholder={
                          field.type
                        }
                        onChange={(
                          event
                        ) =>
                          setForm(
                            (current) => ({
                              ...current,
                              [field.name]:
                                event.target.value
                            })
                          )
                        }
                      />
                    )}
                  </label>
                );
              }
            )}
          </div>

          <button
            className="saveButton"
            disabled={saving}
            onClick={() =>
              void save()
            }
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

                  {visibleFields.map(
                    (field) => (
                      <th
                        key={
                          field.name
                        }
                      >
                        {field.name}
                      </th>
                    )
                  )}

                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>

              <tbody>
                {rows.map(
                  (row) => (
                    <tr
                      key={String(
                        row.id
                      )}
                    >
                      <td>
                        {String(
                          row.id ?? ""
                        )}
                      </td>

                      {visibleFields.map(
                        (field) => (
                          <td
                            key={
                              field.name
                            }
                          >
                            {String(
                              row[
                                field.name
                              ] ?? ""
                            )}
                          </td>
                        )
                      )}

                      <td>
                        {String(
                          row.created_at ??
                          ""
                        )}
                      </td>

                      <td>
                        <div
                          style={{
                            display: "flex",
                            gap: 8
                          }}
                        >
                          <button
                            style={{
                              border: 0,
                              background: "transparent",
                              color: "#2563eb",
                              cursor: "pointer"
                            }}
                            onClick={() =>
                              startEdit(row)
                            }
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
                            onClick={() =>
                              void removeRow(row)
                            }
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}

                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={
                        visibleFields.length + 3
                      }
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

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 16,
              fontSize: 13,
              color: "#667085"
            }}
          >
            <span>
              第 {page} / {totalPages} 页
            </span>

            <div
              style={{
                display: "flex",
                gap: 8
              }}
            >
              <button
                disabled={page <= 1}
                style={{
                  padding: "7px 12px",
                  border: "1px solid #dfe4ec",
                  background: "white",
                  borderRadius: 7,
                  cursor: page <= 1
                    ? "not-allowed"
                    : "pointer",
                  opacity: page <= 1 ? .5 : 1
                }}
                onClick={() =>
                  setPage(
                    (current) =>
                      Math.max(
                        current - 1,
                        1
                      )
                  )
                }
              >
                上一页
              </button>

              <button
                disabled={page >= totalPages}
                style={{
                  padding: "7px 12px",
                  border: "1px solid #dfe4ec",
                  background: "white",
                  borderRadius: 7,
                  cursor:
                    page >= totalPages
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    page >= totalPages
                      ? .5
                      : 1
                }}
                onClick={() =>
                  setPage(
                    (current) =>
                      Math.min(
                        current + 1,
                        totalPages
                      )
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
