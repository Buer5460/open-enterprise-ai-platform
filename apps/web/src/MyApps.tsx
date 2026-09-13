import React from "react";
import {
  apiFetch,
  apiUrl
} from "./apiClient";
import "./MyApps.css";

export type MyAppItem = {
  id: string;
  displayName?: string;
  name: string;
  description?: string;
  version: string;
  status: string;
  navigation?: unknown[];
  metadata?: {
    roles?: unknown[];
    entities?: Array<{
      name?: string;
      description?: string;
    }>;
  };
};

type Preference = {
  appId: string;
  favorite: boolean;
  lastOpenedAt?: string;
};

type FilterMode =
  | "all"
  | "favorites"
  | "recent";

export function MyApps(props: {
  apps: MyAppItem[];
  loading: boolean;
  openApp: (item: MyAppItem) => void;
}) {
  const [preferences, setPreferences] =
    React.useState<Record<string, Preference>>({});
  const [query, setQuery] = React.useState("");
  const [mode, setMode] =
    React.useState<FilterMode>("all");
  const [working, setWorking] =
    React.useState<string | null>(null);
  const [message, setMessage] =
    React.useState("");

  const loadPreferences = React.useCallback(async () => {
    try {
      const response = await apiFetch(
        apiUrl("/api/app-preferences")
      );
      const result = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !result.ok) return;

      const map: Record<string, Preference> = {};
      for (const item of result.preferences ?? []) {
        map[item.appId] = item;
      }
      setPreferences(map);
    } catch {
      // App cards remain usable if preference storage is temporarily unavailable.
    }
  }, []);

  React.useEffect(() => {
    void loadPreferences();
  }, [loadPreferences, props.apps.length]);

  async function toggleFavorite(
    app: MyAppItem,
    event: React.MouseEvent
  ) {
    event.stopPropagation();
    const current = Boolean(
      preferences[app.id]?.favorite
    );
    setWorking(app.id);
    setMessage("");

    try {
      const response = await apiFetch(
        apiUrl(
          `/api/app-preferences/${encodeURIComponent(app.id)}`
        ),
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            favorite: !current
          })
        }
      );
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "收藏状态更新失败"
        );
      }

      setPreferences((items) => ({
        ...items,
        [app.id]: result.preference
      }));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "收藏状态更新失败"
      );
    } finally {
      setWorking(null);
    }
  }

  async function open(app: MyAppItem) {
    props.openApp(app);

    try {
      const response = await apiFetch(
        apiUrl(
          `/api/app-preferences/${encodeURIComponent(app.id)}/open`
        ),
        { method: "POST" }
      );
      const result = await response
        .json()
        .catch(() => ({}));
      if (response.ok && result.ok) {
        setPreferences((items) => ({
          ...items,
          [app.id]: result.preference
        }));
      }
    } catch {
      // Opening the actual app must not depend on preference telemetry.
    }
  }

  const normalizedQuery =
    query.trim().toLowerCase();

  const visible = [...props.apps]
    .filter((app) => {
      const preference = preferences[app.id];
      if (
        mode === "favorites" &&
        !preference?.favorite
      ) {
        return false;
      }
      if (
        mode === "recent" &&
        !preference?.lastOpenedAt
      ) {
        return false;
      }

      if (!normalizedQuery) return true;

      const searchable = [
        app.displayName,
        app.name,
        app.description,
        ...(app.metadata?.entities ?? []).flatMap(
          (entity) => [
            entity.name,
            entity.description
          ]
        )
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(
        normalizedQuery
      );
    })
    .sort((a, b) => {
      const pa = preferences[a.id];
      const pb = preferences[b.id];

      if (mode === "recent") {
        return timestamp(pb?.lastOpenedAt) -
          timestamp(pa?.lastOpenedAt);
      }

      if (
        Boolean(pa?.favorite) !==
        Boolean(pb?.favorite)
      ) {
        return pa?.favorite ? -1 : 1;
      }

      const recent =
        timestamp(pb?.lastOpenedAt) -
        timestamp(pa?.lastOpenedAt);
      if (recent !== 0) return recent;

      return displayName(a).localeCompare(
        displayName(b),
        "zh-CN"
      );
    });

  return (
    <section className="myAppsSection">
      <div className="myAppsHeading">
        <div>
          <h3>我的应用</h3>
          <p>
            搜索、收藏和最近使用状态会跟随当前企业成员账号保存。
          </p>
        </div>

        <div className="myAppsFilters">
          <input
            value={query}
            onChange={(event) =>
              setQuery(event.target.value)
            }
            placeholder="搜索应用、业务实体…"
          />
          <select
            value={mode}
            onChange={(event) =>
              setMode(
                event.target.value as FilterMode
              )
            }
          >
            <option value="all">全部应用</option>
            <option value="favorites">我的收藏</option>
            <option value="recent">最近使用</option>
          </select>
        </div>
      </div>

      {message && (
        <div className="myAppsMessage">
          {message}
        </div>
      )}

      {props.loading && (
        <div className="empty">
          正在加载应用……
        </div>
      )}

      {!props.loading && props.apps.length === 0 && (
        <div className="empty">
          还没有企业应用。先从上方业务模板一键创建。
        </div>
      )}

      {!props.loading &&
        props.apps.length > 0 &&
        visible.length === 0 && (
          <div className="empty">
            当前筛选条件下没有应用。
          </div>
        )}

      <div className="appGrid">
        {visible.map((item) => {
          const preference =
            preferences[item.id];

          return (
            <article
              className="appCard myAppCard"
              key={item.id}
              onDoubleClick={() => void open(item)}
            >
              <div className="appTop">
                <div className="appIcon">
                  {displayName(item)[0]}
                </div>
                <div className="myAppTopActions">
                  <button
                    className={
                      preference?.favorite
                        ? "favoriteButton active"
                        : "favoriteButton"
                    }
                    disabled={working === item.id}
                    title={
                      preference?.favorite
                        ? "取消收藏"
                        : "收藏应用"
                    }
                    onClick={(event) =>
                      void toggleFavorite(
                        item,
                        event
                      )
                    }
                  >
                    {preference?.favorite
                      ? "★"
                      : "☆"}
                  </button>
                  <span className="status">
                    ● 已启用
                  </span>
                </div>
              </div>

              <h4>{displayName(item)}</h4>
              <p className="description">
                {item.description}
              </p>

              <div className="appMeta">
                <span>
                  页面 {item.navigation?.length ?? 0}
                </span>
                <span>
                  数据实体 {item.metadata?.entities?.length ?? 0}
                </span>
                {preference?.lastOpenedAt && (
                  <span>
                    最近 {relativeTime(
                      preference.lastOpenedAt
                    )}
                  </span>
                )}
              </div>

              <div className="cardFooter">
                <span>v{item.version}</span>
                <button
                  onClick={() => void open(item)}
                >
                  打开应用 →
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function displayName(
  app: MyAppItem
): string {
  return app.displayName || app.name;
}

function timestamp(
  value?: string
): number {
  if (!value) return 0;
  const date = new Date(value).getTime();
  return Number.isFinite(date) ? date : 0;
}

function relativeTime(
  value: string
): string {
  const time = timestamp(value);
  if (!time) return "使用";

  const delta = Date.now() - time;
  const minutes = Math.max(
    Math.floor(delta / 60_000),
    0
  );

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  return days < 30
    ? `${days} 天前`
    : new Date(time).toLocaleDateString("zh-CN");
}
