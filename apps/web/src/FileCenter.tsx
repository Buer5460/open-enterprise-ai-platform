import React from "react";
import {
  apiFetch,
  apiUrl
} from "./apiClient";
import "./FileCenter.css";

type StoredFile = {
  id: string;
  organizationId: string;
  appId?: string;
  uploadedBy: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
};

type AppItem = {
  id: string;
  displayName?: string;
  name: string;
};

export function FileCenter() {
  const [files, setFiles] =
    React.useState<StoredFile[]>([]);
  const [apps, setApps] =
    React.useState<AppItem[]>([]);
  const [appId, setAppId] =
    React.useState("");
  const [selected, setSelected] =
    React.useState<File | null>(null);
  const [working, setWorking] =
    React.useState(false);
  const [message, setMessage] =
    React.useState("");

  const load = React.useCallback(async () => {
    const [fileResponse, appResponse] = await Promise.all([
      apiFetch(apiUrl("/api/files?limit=200")),
      apiFetch(apiUrl("/api/apps"))
    ]);

    const fileResult = await fileResponse.json();
    const appResult = await appResponse.json();

    if (!fileResponse.ok || !fileResult.ok) {
      throw new Error(
        fileResult.error ?? "文件列表加载失败"
      );
    }

    setFiles(fileResult.files ?? []);
    setApps(appResult.apps ?? []);
  }, []);

  React.useEffect(() => {
    void load().catch((error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "文件中心加载失败"
      );
    });
  }, [load]);

  async function upload() {
    if (!selected) {
      setMessage("请先选择文件。");
      return;
    }

    setWorking(true);
    setMessage("正在上传并计算文件校验值…");

    try {
      const contentBase64 =
        await fileToBase64(selected);
      const response = await apiFetch(
        apiUrl("/api/files"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: selected.name,
            mimeType:
              selected.type ||
              "application/octet-stream",
            contentBase64,
            appId: appId || undefined
          })
        }
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "文件上传失败"
        );
      }

      setSelected(null);
      const input = document.querySelector<HTMLInputElement>(
        "#oeap-file-input"
      );
      if (input) input.value = "";
      setMessage(`已上传：${result.file.name}`);
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "文件上传失败"
      );
    } finally {
      setWorking(false);
    }
  }

  async function download(file: StoredFile) {
    setMessage(`正在下载 ${file.name}…`);

    try {
      const response = await apiFetch(
        apiUrl(
          `/api/files/${encodeURIComponent(file.id)}/content`
        )
      );

      if (!response.ok) {
        const result = await response
          .json()
          .catch(() => ({}));
        throw new Error(
          result.error ?? "文件下载失败"
        );
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage("下载已开始。");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "文件下载失败"
      );
    }
  }

  async function remove(file: StoredFile) {
    if (!window.confirm(`删除文件「${file.name}」？`)) {
      return;
    }

    const response = await apiFetch(
      apiUrl(
        `/api/files/${encodeURIComponent(file.id)}`
      ),
      { method: "DELETE" }
    );
    const result = await response.json();

    if (!response.ok || !result.ok) {
      setMessage(
        result.error ?? "文件删除失败"
      );
      return;
    }

    setMessage("文件已删除。");
    await load();
  }

  return (
    <section className="fileCenter">
      <div className="fileCenterHeader">
        <div>
          <span>ENTERPRISE FILE LAYER</span>
          <h1>文件与文档中心</h1>
          <p>
            企业文件按组织隔离，并继承应用访问权限。文件内容、元数据和 SHA-256 校验值均由 OEAP 管理。
          </p>
        </div>
        <div className="fileCenterCount">
          <strong>{files.length}</strong>
          <span>文件</span>
        </div>
      </div>

      <div className="fileUploadPanel">
        <label>
          <span>关联应用（可选）</span>
          <select
            value={appId}
            onChange={(event) =>
              setAppId(event.target.value)
            }
          >
            <option value="">企业公共文件</option>
            {apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.displayName ?? app.name}
              </option>
            ))}
          </select>
        </label>

        <label className="filePicker">
          <span>选择文件</span>
          <input
            id="oeap-file-input"
            type="file"
            onChange={(event) =>
              setSelected(
                event.target.files?.[0] ?? null
              )
            }
          />
        </label>

        <button
          disabled={working || !selected}
          onClick={() => void upload()}
        >
          {working ? "上传中…" : "上传到企业文件中心"}
        </button>
      </div>

      {message && (
        <div className="fileCenterMessage">
          {message}
        </div>
      )}

      <div className="fileTable">
        <div className="fileTableHeader">
          <span>文件</span>
          <span>类型 / 大小</span>
          <span>归属</span>
          <span>上传时间</span>
          <span>操作</span>
        </div>

        {files.length === 0 ? (
          <div className="fileEmpty">
            暂无企业文件。上传合同、方案、图片或业务资料后，会在这里统一管理。
          </div>
        ) : (
          files.map((file) => (
            <div className="fileRow" key={file.id}>
              <div>
                <strong>{file.name}</strong>
                <small title={file.sha256}>
                  SHA-256 · {file.sha256.slice(0, 14)}…
                </small>
              </div>
              <div>
                <span>{file.mimeType}</span>
                <small>{formatBytes(file.size)}</small>
              </div>
              <div>
                <span>
                  {file.appId
                    ? apps.find((app) => app.id === file.appId)
                        ?.displayName ?? file.appId
                    : "企业公共"}
                </span>
              </div>
              <div>
                <span>{formatTime(file.createdAt)}</span>
              </div>
              <div className="fileActions">
                <button onClick={() => void download(file)}>
                  下载
                </button>
                <button
                  className="danger"
                  onClick={() => void remove(file)}
                >
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(
      new Error("无法读取所选文件")
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN");
}
