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

function inputType(type: string) {
  const value = type.toLowerCase();

  if (
    value.includes("number") ||
    value.includes("int") ||
    value.includes("amount")
  ) {
    return "number";
  }

  if (value.includes("date")) {
    return "date";
  }

  return "text";
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

  const entity =
    entities.find(
      (item) =>
        item.name === entityName
    );

  const fields =
    entity?.fields ?? [];

  const visibleFields =
    fields.slice(0, 6);

  async function loadRows() {
    if (!entityName) {
      return;
    }

    const response =
      await fetch(
        `http://127.0.0.1:8787/api/apps/${encodeURIComponent(
          appId
        )}/data/${encodeURIComponent(
          entityName
        )}`
      );

    const result =
      await response.json();

    setRows(
      result.rows ?? []
    );
  }

  React.useEffect(() => {
    void loadRows();
  }, [entityName, appId]);

  async function save() {
    if (!entityName) {
      return;
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

        const type =
          field.type.toLowerCase();

        payload[field.name] =
          type.includes("number") ||
          type.includes("int") ||
          type.includes("amount")
            ? Number(value)
            : value;
      }

      const response =
        await fetch(
          `http://127.0.0.1:8787/api/apps/${encodeURIComponent(
            appId
          )}/data/${encodeURIComponent(
            entityName
          )}`,
          {
            method: "POST",
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

      setForm({});
      await loadRows();

      alert("保存成功");
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

  return (
    <section className="generatedPage">

      <div className="generatedPageHeader">

        <span className="generatedTag">
          AI GENERATED BUSINESS PAGE
        </span>

        <h2>{pageLabel}</h2>

        <p>
          当前页面已经连接到真实 SQLite 数据库。
        </p>

        <div className="entitySelector">
          <span>数据实体：</span>

          <select
            value={entityName}
            onChange={(event) => {
              setEntityName(
                event.target.value
              );
              setForm({});
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

      <div className="crudLayout">

        <div className="crudPanel">

          <div className="crudPanelTitle">
            <h3>新增数据</h3>
            <span>
              {entity?.description}
            </span>
          </div>

          <div className="dynamicForm">

            {fields.map(
              (field) => (
                <label
                  key={field.name}
                >
                  <span>
                    {field.name}
                    {field.required
                      ? " *"
                      : ""}
                  </span>

                  <input
                    type={
                      inputType(
                        field.type
                      )
                    }
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
                            event
                              .target
                              .value
                        })
                      )
                    }
                  />
                </label>
              )
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
              : "＋ 保存数据"}
          </button>
        </div>

        <div className="crudPanel">

          <div className="crudPanelTitle">
            <h3>数据列表</h3>
            <span>
              共 {rows.length} 条
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
                                field
                                  .name
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
                    </tr>
                  )
                )}

                {rows.length ===
                  0 && (
                  <tr>
                    <td
                      colSpan={
                        visibleFields
                          .length + 2
                      }
                      className="noRows"
                    >
                      暂无数据，请先在左侧新增一条记录。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </section>
  );
}
