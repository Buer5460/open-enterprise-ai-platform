import React from "react";
import {
  apiFetch,
  apiUrl
} from "./apiClient";
import { usePermission } from "./usePermission";
import "./DataExchangeCenter.css";

type Entity = {
  name: string;
  description?: string;
  fields?: Array<{
    name: string;
    label?: string;
    type: string;
    required?: boolean;
  }>;
};

type AppItem = {
  id: string;
  displayName?: string;
  name: string;
  metadata?: {
    entities?: Entity[];
  };
};

type Preview = {
  ok: boolean;
  totalRows: number;
  validRows: number;
  errorCount: number;
  errors: Array<{
    row: number;
    field?: string;
    error: string;
  }>;
  preview: Array<Record<string, unknown>>;
};

type PendingImport = {
  format: "csv" | "json";
  csv?: string;
  rows?: Array<Record<string, unknown>>;
  fileName: string;
};

const MAX_BROWSER_FILE_BYTES = 5 * 1024 * 1024;

export function DataExchangeCenter() {
  const [apps, setApps] = React.useState<AppItem[]>([]);
  const [appId, setAppId] = React.useState("");
  const [entityName, setEntityName] = React.useState("");
  const [pending, setPending] = React.useState<PendingImport | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [working, setWorking] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const selectedApp = apps.find((item) => item.id === appId);
  const entities = selectedApp?.metadata?.entities ?? [];
  const selectedEntity = entities.find((item) => item.name === entityName);
  const canWrite = usePermission("data.write", appId || undefined);

  const loadApps = React.useCallback(async () => {
    try {
      const response = await apiFetch(apiUrl("/api/apps"));
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "应用列表加载失败");
      }

      const next = (result.apps ?? []) as AppItem[];
      setApps(next);
      setAppId((current) => {
        if (current && next.some((item) => item.id === current)) {
          return current;
        }
        return next[0]?.id ?? "";
      });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "应用列表加载失败"
      );
    }
  }, []);

  React.useEffect(() => {
    void loadApps();
  }, [loadApps]);

  React.useEffect(() => {
    const nextEntities =
      apps.find((item) => item.id === appId)?.metadata?.entities ?? [];

    setEntityName((current) => {
      if (
        current &&
        nextEntities.some((item) => item.name === current)
      ) {
        return current;
      }
      return nextEntities[0]?.name ?? "";
    });
    resetImport();
  }, [appId, apps]);

  React.useEffect(() => {
    resetImport();
  }, [entityName]);

  function resetImport() {
    setPending(null);
    setPreview(null);
    setMessage("");
  }

  async function handleFile(file: File) {
    resetImport();

    if (!appId || !entityName) {
      setMessage("请先选择应用和数据实体。");
      return;
    }

    if (file.size > MAX_BROWSER_FILE_BYTES) {
      setMessage("导入文件超过 5 MB，请拆分后再导入。");
      return;
    }

    const lower = file.name.toLowerCase();
    const text = await file.text();

    try {
      let next: PendingImport;

      if (lower.endsWith(".json")) {
        const parsed = JSON.parse(text);
        const rows = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.rows)
            ? parsed.rows
            : undefined;

        if (!rows) {
          throw new Error("JSON 文件必须是数组，或包含 rows 数组。");
        }

        next = {
          format: "json",
          rows,
          fileName: file.name
        };
      } else if (lower.endsWith(".csv")) {
        next = {
          format: "csv",
          csv: text,
          fileName: file.name
        };
      } else {
        throw new Error("只支持 .csv 或 .json 文件。");
      }

      setPending(next);
      await preflight(next);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "无法读取导入文件"
      );
    }
  }

  async function preflight(value: PendingImport) {
    setWorking(true);
    setMessage("正在预检导入数据…");
    setPreview(null);

    try {
      const response = await apiFetch(
        exchangeUrl("import"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            ...value,
            fileName: undefined,
            dryRun: true
          })
        }
      );
      const result = await response.json().catch(() => ({}));

      if (
        response.status === 422 ||
        (response.ok && typeof result.totalRows === "number")
      ) {
        setPreview(result as Preview);
        setMessage(
          result.errorCount > 0
            ? `预检发现 ${result.errorCount} 个问题，请修正文件后重新导入。`
            : `预检通过：${result.validRows} 行可以安全导入。`
        );
        return;
      }

      throw new Error(result.error ?? "导入预检失败");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "导入预检失败"
      );
    } finally {
      setWorking(false);
    }
  }

  async function importRows() {
    if (!pending || !preview || !preview.ok || preview.errorCount > 0) {
      return;
    }

    setWorking(true);
    setMessage("正在事务化导入数据…");

    try {
      const response = await apiFetch(
        exchangeUrl("import"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            format: pending.format,
            csv: pending.csv,
            rows: pending.rows,
            dryRun: false
          })
        }
      );
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "批量导入失败");
      }

      setMessage(
        `导入完成：新增 ${result.imported} 行，当前共 ${result.total} 行。`
      );
      setPending(null);
      setPreview(null);
      window.dispatchEvent(
        new CustomEvent("oeap-data-changed", {
          detail: { appId, entity: entityName }
        })
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "批量导入失败"
      );
    } finally {
      setWorking(false);
    }
  }

  async function exportData(format: "csv" | "json") {
    if (!appId || !entityName) return;

    setWorking(true);
    setMessage(`正在导出 ${format.toUpperCase()}…`);

    try {
      const response = await apiFetch(
        `${exchangeUrl("export")}?format=${format}`
      );

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? "导出失败");
      }

      let blob: Blob;
      let extension: string;

      if (format === "json") {
        const result = await response.json();
        blob = new Blob(
          [JSON.stringify(result.rows ?? [], null, 2)],
          { type: "application/json;charset=utf-8" }
        );
        extension = "json";
      } else {
        blob = await response.blob();
        extension = "csv";
      }

      downloadBlob(
        blob,
        `${selectedApp?.displayName ?? selectedApp?.name ?? "oeap"}-${entityName}.${extension}`
      );

      setMessage("导出完成。");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "导出失败"
      );
    } finally {
      setWorking(false);
    }
  }

  function exchangeUrl(action: "import" | "export") {
    return apiUrl(
      `/api/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entityName)}/${action}`
    );
  }

  if (apps.length === 0) {
    return null;
  }

  return (
    <section className="dataExchangeCenter">
      <div className="dataExchangeHeading">
        <div>
          <span>BUSINESS DATA MIGRATION</span>
          <h3>批量导入 / 导出</h3>
          <p>
            把现有 Excel、CRM、商户表或业务系统数据迁进 OEAP。CSV 支持中文字段名，导入前会先做完整预检。
          </p>
        </div>
      </div>

      <div className="dataExchangeSelectors">
        <label>
          <span>应用</span>
          <select
            value={appId}
            onChange={(event) => setAppId(event.target.value)}
          >
            {apps.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName ?? item.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>数据实体</span>
          <select
            value={entityName}
            onChange={(event) => setEntityName(event.target.value)}
          >
            {entities.map((item) => (
              <option key={item.name} value={item.name}>
                {item.description
                  ? `${item.name} · ${item.description}`
                  : item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedEntity && (
        <div className="dataExchangeFields">
          {(selectedEntity.fields ?? []).map((field) => (
            <span key={field.name}>
              {field.label || field.name}
              {field.required ? " *" : ""}
            </span>
          ))}
        </div>
      )}

      <div className="dataExchangeActions">
        <label className={
          canWrite === false
            ? "importFileButton disabled"
            : "importFileButton"
        }>
          选择 CSV / JSON
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            disabled={working || canWrite !== true}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              event.currentTarget.value = "";
            }}
          />
        </label>

        <button
          disabled={working || !entityName}
          onClick={() => void exportData("csv")}
        >
          导出 CSV
        </button>
        <button
          disabled={working || !entityName}
          onClick={() => void exportData("json")}
        >
          导出 JSON
        </button>
      </div>

      {canWrite === false && (
        <div className="dataExchangeNotice">
          当前成员只有读取权限，可以导出，但不能批量导入数据。
        </div>
      )}

      {pending && (
        <div className="dataExchangeFile">
          <strong>{pending.fileName}</strong>
          <span>{pending.format.toUpperCase()}</span>
        </div>
      )}

      {message && (
        <div className="dataExchangeMessage">
          {message}
        </div>
      )}

      {preview && (
        <div className="dataExchangePreview">
          <div className="dataExchangePreviewStats">
            <div>
              <strong>{preview.totalRows}</strong>
              <span>总行数</span>
            </div>
            <div>
              <strong>{preview.validRows}</strong>
              <span>有效行</span>
            </div>
            <div>
              <strong>{preview.errorCount}</strong>
              <span>错误</span>
            </div>
          </div>

          {preview.errors.length > 0 && (
            <div className="dataExchangeErrors">
              {preview.errors.slice(0, 12).map((item, index) => (
                <div key={`${item.row}-${item.field}-${index}`}>
                  第 {item.row} 行
                  {item.field ? ` · ${item.field}` : ""}
                  ：{item.error}
                </div>
              ))}
            </div>
          )}

          {preview.ok && preview.errorCount === 0 && canWrite === true && (
            <button
              className="dataExchangeConfirm"
              disabled={working}
              onClick={() => void importRows()}
            >
              确认导入 {preview.validRows} 行
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.replace(/[\\/:*?"<>|\r\n]+/g, "_");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
