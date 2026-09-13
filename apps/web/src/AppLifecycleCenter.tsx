import React from "react";
import {
  apiFetch,
  apiUrl
} from "./apiClient";
import { usePermission } from "./usePermission";
import "./AppLifecycleCenter.css";

type ActiveApp = {
  id: string;
  displayName?: string;
  name: string;
  description?: string;
  version?: string;
};

type ArchivedApp = ActiveApp & {
  archivedAt: string;
  archivedBy: string;
};

export function AppLifecycleCenter(props: {
  onChanged: () => Promise<void> | void;
}) {
  const [active, setActive] = React.useState<ActiveApp[]>([]);
  const [archived, setArchived] = React.useState<ArchivedApp[]>([]);
  const [working, setWorking] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState("");
  const canManage = usePermission("apps.manage");

  const load = React.useCallback(async () => {
    try {
      const activeResponse = await apiFetch(apiUrl("/api/apps"));
      const activeResult = await activeResponse.json().catch(() => ({}));

      if (!activeResponse.ok) {
        throw new Error(activeResult.error ?? "应用列表加载失败");
      }

      setActive(activeResult.apps ?? []);

      if (canManage === true) {
        const archiveResponse = await apiFetch(
          apiUrl("/api/apps-archive")
        );
        const archiveResult = await archiveResponse
          .json()
          .catch(() => ({}));

        if (!archiveResponse.ok || !archiveResult.ok) {
          throw new Error(
            archiveResult.error ?? "归档列表加载失败"
          );
        }
        setArchived(archiveResult.apps ?? []);
      } else {
        setArchived([]);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "应用生命周期加载失败"
      );
    }
  }, [canManage]);

  React.useEffect(() => {
    if (canManage !== null) {
      void load();
    }
  }, [canManage, load]);

  async function archive(app: ActiveApp) {
    if (canManage !== true) return;

    const confirmed = window.confirm(
      `归档应用「${app.displayName ?? app.name}」？\n\n归档不会删除数据库，稍后可以恢复。`
    );
    if (!confirmed) return;

    setWorking(app.id);
    setMessage("");

    try {
      const response = await apiFetch(
        apiUrl(`/api/apps/${encodeURIComponent(app.id)}/archive`),
        { method: "POST" }
      );
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "应用归档失败");
      }

      setMessage("应用已归档，数据库和历史数据仍被保留。");
      await Promise.all([
        load(),
        Promise.resolve(props.onChanged())
      ]);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "应用归档失败"
      );
    } finally {
      setWorking(null);
    }
  }

  async function restore(app: ArchivedApp) {
    if (canManage !== true) return;

    setWorking(app.id);
    setMessage("");

    try {
      const response = await apiFetch(
        apiUrl(
          `/api/apps-archive/${encodeURIComponent(app.id)}/restore`
        ),
        { method: "POST" }
      );
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "应用恢复失败");
      }

      setMessage("应用已恢复，原数据库和业务数据继续使用。");
      await Promise.all([
        load(),
        Promise.resolve(props.onChanged())
      ]);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "应用恢复失败"
      );
    } finally {
      setWorking(null);
    }
  }

  if (canManage === false) {
    return null;
  }

  return (
    <section className="appLifecycleCenter">
      <div className="appLifecycleHeading">
        <div>
          <span>APPLICATION LIFECYCLE</span>
          <h3>应用归档与恢复</h3>
          <p>
            不再使用的应用可以先归档。归档只隐藏应用，不删除 SQLite 数据库、附件或历史版本，需要时可原样恢复。
          </p>
        </div>
        <button onClick={() => void load()}>
          刷新
        </button>
      </div>

      {message && (
        <div className="appLifecycleMessage">
          {message}
        </div>
      )}

      <div className="appLifecycleGrid">
        <article className="appLifecyclePanel">
          <div className="appLifecyclePanelTitle">
            <h4>正在使用</h4>
            <span>{active.length} 个</span>
          </div>

          <div className="appLifecycleList">
            {active.map((app) => (
              <div className="appLifecycleRow" key={app.id}>
                <div>
                  <strong>{app.displayName ?? app.name}</strong>
                  <span>v{app.version ?? "-"}</span>
                </div>
                <button
                  disabled={Boolean(working)}
                  onClick={() => void archive(app)}
                >
                  {working === app.id ? "处理中…" : "归档"}
                </button>
              </div>
            ))}

            {active.length === 0 && (
              <div className="appLifecycleEmpty">
                当前没有正在使用的应用。
              </div>
            )}
          </div>
        </article>

        <article className="appLifecyclePanel">
          <div className="appLifecyclePanelTitle">
            <h4>已归档</h4>
            <span>{archived.length} 个</span>
          </div>

          <div className="appLifecycleList">
            {archived.map((app) => (
              <div className="appLifecycleRow" key={app.id}>
                <div>
                  <strong>{app.displayName ?? app.name}</strong>
                  <span>
                    {new Date(app.archivedAt).toLocaleString("zh-CN")}
                  </span>
                </div>
                <button
                  disabled={Boolean(working)}
                  onClick={() => void restore(app)}
                >
                  {working === app.id ? "处理中…" : "恢复"}
                </button>
              </div>
            ))}

            {archived.length === 0 && (
              <div className="appLifecycleEmpty">
                暂无归档应用。
              </div>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
