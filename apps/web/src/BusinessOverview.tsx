import React from "react";
import {
  apiFetch,
  apiUrl
} from "./apiClient";
import "./BusinessOverview.css";

type EntityStat = {
  name: string;
  description?: string;
  fields: number;
  records: number;
};

type AppSummary = {
  id: string;
  name: string;
  version?: string;
  entities: number;
  records: number;
  entityStats: EntityStat[];
};

type OverviewResponse = {
  ok: boolean;
  apps: AppSummary[];
  totals: {
    apps: number;
    entities: number;
    records: number;
  };
};

export function BusinessOverview() {
  const [data, setData] = React.useState<OverviewResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [message, setMessage] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const response = await apiFetch(
        apiUrl("/api/platform/data-overview")
      );
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "经营数据概览加载失败"
        );
      }

      setData(result as OverviewResponse);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "经营数据概览加载失败"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();

    const changed = () => void load();
    window.addEventListener("oeap-data-changed", changed);

    return () => {
      window.removeEventListener("oeap-data-changed", changed);
    };
  }, [load]);

  if (loading && !data) {
    return (
      <section className="businessOverview">
        <div className="businessOverviewEmpty">
          正在统计企业业务数据…
        </div>
      </section>
    );
  }

  if (!data) {
    return message ? (
      <section className="businessOverview">
        <div className="businessOverviewEmpty">
          {message}
        </div>
      </section>
    ) : null;
  }

  const activeApps = data.apps.filter((item) => item.records > 0).length;
  const topEntities = data.apps
    .flatMap((app) =>
      app.entityStats.map((entity) => ({
        ...entity,
        appName: app.name,
        appId: app.id
      }))
    )
    .sort((a, b) => b.records - a.records)
    .slice(0, 8);

  return (
    <section className="businessOverview">
      <div className="businessOverviewHeading">
        <div>
          <span>ENTERPRISE BUSINESS OVERVIEW</span>
          <h3>经营数据概览</h3>
          <p>
            汇总当前成员有权限访问的应用与业务数据，帮助判断哪些系统已经开始真实使用。
          </p>
        </div>
        <button onClick={() => void load()}>
          刷新
        </button>
      </div>

      <div className="businessOverviewStats">
        <div>
          <strong>{data.totals.apps}</strong>
          <span>企业应用</span>
        </div>
        <div>
          <strong>{activeApps}</strong>
          <span>已有真实数据的应用</span>
        </div>
        <div>
          <strong>{data.totals.entities}</strong>
          <span>数据实体</span>
        </div>
        <div>
          <strong>{data.totals.records}</strong>
          <span>业务记录</span>
        </div>
      </div>

      <div className="businessOverviewGrid">
        <article className="businessOverviewPanel">
          <h4>应用使用情况</h4>
          <div className="businessOverviewList">
            {data.apps.map((app) => (
              <div key={app.id} className="businessOverviewRow">
                <div>
                  <strong>{app.name}</strong>
                  <span>
                    {app.entities} 个实体 · v{app.version ?? "-"}
                  </span>
                </div>
                <em>{app.records} 条</em>
              </div>
            ))}

            {data.apps.length === 0 && (
              <div className="businessOverviewEmpty">
                当前还没有可访问的企业应用。
              </div>
            )}
          </div>
        </article>

        <article className="businessOverviewPanel">
          <h4>数据量最高的业务对象</h4>
          <div className="businessOverviewList">
            {topEntities.map((entity) => (
              <div
                key={`${entity.appId}-${entity.name}`}
                className="businessOverviewRow"
              >
                <div>
                  <strong>
                    {entity.description || entity.name}
                  </strong>
                  <span>
                    {entity.appName} · {entity.fields} 个字段
                  </span>
                </div>
                <em>{entity.records} 条</em>
              </div>
            ))}

            {topEntities.length === 0 && (
              <div className="businessOverviewEmpty">
                创建应用并录入数据后，这里会自动形成经营概览。
              </div>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
