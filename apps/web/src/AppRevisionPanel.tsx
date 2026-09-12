import React from "react";
import {
  apiFetch,
  apiUrl
} from "./apiClient";
import "./AppRevisionPanel.css";

type Props = {
  app: any;
  onUpdated: (app: any) => void;
};

type AppVersion = {
  version: string;
  current: boolean;
  archivedAt?: string | null;
  displayName?: string;
};

export function AppRevisionPanel({
  app,
  onUpdated
}: Props) {
  const [instruction, setInstruction] =
    React.useState("");
  const [working, setWorking] =
    React.useState(false);
  const [historyWorking, setHistoryWorking] =
    React.useState<string | null>(null);
  const [message, setMessage] =
    React.useState("");
  const [versions, setVersions] =
    React.useState<AppVersion[]>([]);

  const loadVersions = React.useCallback(async () => {
    try {
      const response = await apiFetch(
        apiUrl(
          `/api/apps/${encodeURIComponent(app.id)}/versions`
        )
      );
      const result = await response.json();

      if (response.ok && result.ok) {
        setVersions(result.versions ?? []);
      }
    } catch {
      // Version history is additive; failure must not block application use.
    }
  }, [app.id, app.version]);

  React.useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  async function revise() {
    const value = instruction.trim();

    if (!value) {
      setMessage("请先描述你希望修改什么。");
      return;
    }

    setWorking(true);
    setMessage("AI 正在分析现有应用并生成安全修改方案……");

    try {
      const response = await apiFetch(
        apiUrl(
          `/api/apps/${encodeURIComponent(app.id)}/revise`
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            instruction: value
          })
        }
      );

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "应用修改失败"
        );
      }

      setInstruction("");
      setMessage(
        `修改完成：v${result.previousVersion ?? app.version} → v${result.version ?? result.app?.version ?? app.version}。旧版本已自动归档。`
      );

      onUpdated(result.app);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "应用修改失败"
      );
    } finally {
      setWorking(false);
    }
  }

  async function restore(version: string) {
    if (
      !window.confirm(
        `确认把应用结构恢复到 v${version}？当前版本会先自动归档，业务数据不会被删除。`
      )
    ) {
      return;
    }

    setHistoryWorking(version);
    setMessage(`正在恢复 v${version}…`);

    try {
      const response = await apiFetch(
        apiUrl(
          `/api/apps/${encodeURIComponent(app.id)}/versions/${encodeURIComponent(version)}/restore`
        ),
        { method: "POST" }
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "版本恢复失败"
        );
      }

      setMessage(
        `已从 v${result.restoredFrom} 恢复，并生成新版本 v${result.version}。`
      );
      onUpdated(result.app);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "版本恢复失败"
      );
    } finally {
      setHistoryWorking(null);
    }
  }

  return (
    <section className="aiRevisionPanel">
      <div className="aiRevisionCopy">
        <span>AI APP EVOLUTION</span>
        <h3>直接告诉 AI：这个应用还要怎么改？</h3>
        <p>
          AI 会读取当前 Blueprint，在尽量保留已有页面、字段和真实数据的前提下升级应用。每次升级前都会自动保存版本快照，可随时回滚。
        </p>
      </div>

      <div className="aiRevisionComposer">
        <textarea
          value={instruction}
          disabled={working}
          onChange={(event) =>
            setInstruction(event.target.value)
          }
          placeholder="例如：客户增加身份证号和微信字段；订单增加退款状态；再新增一个客户回访页面。"
          rows={3}
        />

        <button
          disabled={working}
          onClick={() => void revise()}
        >
          {working
            ? "AI 正在修改…"
            : "让 AI 修改应用"}
        </button>
      </div>

      {message && (
        <div className="aiRevisionMessage">
          {message}
        </div>
      )}

      {versions.length > 0 && (
        <div className="appVersionHistory">
          <div className="appVersionHistoryHeader">
            <div>
              <strong>版本历史</strong>
              <span>当前数据保留不变；回滚只恢复应用 Blueprint/页面/字段定义。</span>
            </div>
            <em>{versions.length} 个版本</em>
          </div>

          <div className="appVersionList">
            {versions.map((version) => (
              <div
                className="appVersionItem"
                key={`${version.version}:${version.current}`}
              >
                <div>
                  <strong>v{version.version}</strong>
                  <span>
                    {version.current
                      ? "当前版本"
                      : version.archivedAt
                        ? `归档于 ${formatTime(version.archivedAt)}`
                        : "历史版本"}
                  </span>
                </div>

                {version.current ? (
                  <em>正在使用</em>
                ) : (
                  <button
                    disabled={Boolean(historyWorking)}
                    onClick={() =>
                      void restore(version.version)
                    }
                  >
                    {historyWorking === version.version
                      ? "恢复中…"
                      : "恢复此版本"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN");
}
