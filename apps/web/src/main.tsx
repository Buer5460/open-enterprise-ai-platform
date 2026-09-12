import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { DataEntityPage } from "./DataEntityPage";
import { AppRevisionPanel } from "./AppRevisionPanel";
import {
  PlatformWorkspace,
  type PlatformView
} from "./PlatformWorkspace";

type Role = {
  name: string;
  description?: string;
  permissions?: string[];
};

type Entity = {
  name: string;
  description?: string;
  fields?: Array<{
    name: string;
    type: string;
    required?: boolean;
  }>;
};

type Workflow = {
  name: string;
  description?: string;
  steps?: string[];
};

type AppManifest = {
  id: string;
  displayName?: string;
  name: string;
  description?: string;
  version: string;
  publisher: string;
  status: string;
  navigation?: Array<{
    id: string;
    label: string;
    path: string;
  }>;
  metadata?: {
    roles?: Role[];
    entities?: Entity[];
    workflows?: Workflow[];
    recommendedPackages?: {
      skills?: unknown[];
      agents?: unknown[];
      connectors?: unknown[];
    };
  };
};

const API = "http://127.0.0.1:8787";

type RootView =
  | "workbench"
  | PlatformView;

function Platform() {
  const [apps, setApps] =
    React.useState<AppManifest[]>([]);

  const [loading, setLoading] =
    React.useState(true);

  const [description, setDescription] =
    React.useState("");

  const [creating, setCreating] =
    React.useState(false);

  const [selectedApp, setSelectedApp] =
    React.useState<AppManifest | null>(null);

  const [activePage, setActivePage] =
    React.useState("overview");

  const [rootView, setRootView] =
    React.useState<RootView>("workbench");

  const loadApps = React.useCallback(async () => {
    const response = await fetch(
      `${API}/api/apps`
    );

    const data = await response.json();
    const nextApps: AppManifest[] =
      data.apps ?? [];

    setApps(nextApps);

    setSelectedApp((current) => {
      if (!current) {
        return null;
      }

      return nextApps.find(
        (item) => item.id === current.id
      ) ?? current;
    });

    return nextApps;
  }, []);

  React.useEffect(() => {
    loadApps()
      .finally(() => {
        setLoading(false);
      });
  }, [loadApps]);

  function applyUpdatedApp(
    updated: AppManifest
  ) {
    setSelectedApp(updated);
    setApps((current) =>
      current.map((item) =>
        item.id === updated.id
          ? updated
          : item
      )
    );
    setActivePage("overview");
  }

  async function createApp() {
    const businessRequest =
      description.trim();

    if (!businessRequest) {
      alert("请先描述你想创建的企业应用。");
      return;
    }

    setCreating(true);

    try {
      const response = await fetch(
        `${API}/api/apps/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            description: businessRequest
          })
        }
      );

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "应用创建失败"
        );
      }

      setDescription("");
      await loadApps();

      alert(
        `应用「${result.app.displayName ?? result.app.name}」创建成功`
      );
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "应用创建失败"
      );
    } finally {
      setCreating(false);
    }
  }

  if (selectedApp) {
    const roles =
      selectedApp.metadata?.roles ?? [];

    const entities =
      selectedApp.metadata?.entities ?? [];

    const workflows =
      selectedApp.metadata?.workflows ?? [];

    return (
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="logo">O</div>
            <div>
              <strong>
                {selectedApp.displayName ?? selectedApp.name}
              </strong>
              <span>OEAP 企业应用</span>
            </div>
          </div>

          <nav>
            <button
              className={
                activePage === "overview"
                  ? "active"
                  : ""
              }
              onClick={() =>
                setActivePage("overview")
              }
            >
              ▣ 应用概览
            </button>

            {selectedApp.navigation?.map(
              (page) => (
                <button
                  key={page.id}
                  className={
                    activePage === page.id
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    setActivePage(page.id)
                  }
                >
                  ◫ {page.label}
                </button>
              )
            )}
          </nav>

          <div className="sidebarFooter">
            <button
              className="backButton"
              onClick={() => {
                setSelectedApp(null);
                setActivePage("overview");
                setRootView("workbench");
              }}
            >
              ← 返回工作台
            </button>
          </div>
        </aside>

        <main className="main">
          <header>
            <div>
              <h1>
                {selectedApp.displayName ?? selectedApp.name}
              </h1>
              <p>{selectedApp.description}</p>
            </div>

            <span className="runtimeBadge">
              ● 已启用 · v{selectedApp.version}
            </span>
          </header>

          {activePage === "overview" ? (
            <>
              <AppRevisionPanel
                app={selectedApp}
                onUpdated={applyUpdatedApp}
              />

              <section className="stats">
                <div>
                  <strong>
                    {selectedApp.navigation?.length ?? 0}
                  </strong>
                  <span>业务页面</span>
                </div>
                <div>
                  <strong>{roles.length}</strong>
                  <span>用户角色</span>
                </div>
                <div>
                  <strong>{entities.length}</strong>
                  <span>数据实体</span>
                </div>
                <div>
                  <strong>{workflows.length}</strong>
                  <span>业务流程</span>
                </div>
              </section>

              <section className="runtimeGrid">
                <article className="runtimePanel">
                  <h3>角色与权限</h3>
                  {roles.map((role) => (
                    <div
                      className="runtimeItem"
                      key={role.name}
                    >
                      <strong>{role.name}</strong>
                      <p>
                        {role.description ?? "企业应用角色"}
                      </p>
                      <small>
                        {(role.permissions ?? [])
                          .slice(0, 5)
                          .join(" · ")}
                      </small>
                    </div>
                  ))}
                </article>

                <article className="runtimePanel">
                  <h3>数据模型</h3>
                  {entities.map((entity) => (
                    <div
                      className="runtimeItem"
                      key={entity.name}
                    >
                      <strong>{entity.name}</strong>
                      <p>
                        {entity.description ?? "业务数据实体"}
                      </p>
                      <small>
                        {(entity.fields ?? [])
                          .slice(0, 6)
                          .map((field) => field.name)
                          .join(" · ")}
                      </small>
                    </div>
                  ))}
                </article>

                <article className="runtimePanel">
                  <h3>业务流程</h3>
                  {workflows.map((workflow) => (
                    <div
                      className="runtimeItem"
                      key={workflow.name}
                    >
                      <strong>{workflow.name}</strong>
                      <p>
                        {workflow.description ?? "自动化业务流程"}
                      </p>
                      <small>
                        {(workflow.steps ?? [])
                          .slice(0, 4)
                          .join(" → ")}
                      </small>
                    </div>
                  ))}
                </article>
              </section>
            </>
          ) : (
            <DataEntityPage
              key={`${selectedApp.version}:${activePage}`}
              appId={selectedApp.id}
              pageLabel={
                selectedApp.navigation
                  ?.find(
                    (page) => page.id === activePage
                  )
                  ?.label ?? activePage
              }
              entities={entities}
            />
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">O</div>
          <div>
            <strong>OpenEnterpriseAI</strong>
            <span>AI 原生企业应用平台</span>
          </div>
        </div>

        <nav>
          <button
            className={
              rootView === "workbench"
                ? "active"
                : ""
            }
            onClick={() =>
              setRootView("workbench")
            }
          >
            ▣ 工作台
          </button>

          <button
            onClick={() =>
              setRootView("workbench")
            }
          >
            ◈ 我的应用
          </button>

          <button
            className={
              rootView === "agents"
                ? "active"
                : ""
            }
            onClick={() =>
              setRootView("agents")
            }
          >
            ◎ Agent
          </button>

          <button
            className={
              rootView === "skills"
                ? "active"
                : ""
            }
            onClick={() =>
              setRootView("skills")
            }
          >
            ◆ Skills
          </button>

          <button
            className={
              rootView === "workflows"
                ? "active"
                : ""
            }
            onClick={() =>
              setRootView("workflows")
            }
          >
            ⇄ Workflows
          </button>

          <button
            className={
              rootView === "connectors"
                ? "active"
                : ""
            }
            onClick={() =>
              setRootView("connectors")
            }
          >
            ⌘ Connectors
          </button>

          <button
            className={
              rootView === "data"
                ? "active"
                : ""
            }
            onClick={() =>
              setRootView("data")
            }
          >
            ▦ 数据中心
          </button>

          <div className="navDivider" />

          <button
            className={
              rootView === "marketplace"
                ? "active"
                : ""
            }
            onClick={() =>
              setRootView("marketplace")
            }
          >
            ◇ Marketplace
          </button>

          <button
            className={
              rootView === "developer"
                ? "active"
                : ""
            }
            onClick={() =>
              setRootView("developer")
            }
          >
            &lt;/&gt; Developer
          </button>
        </nav>

        <div className="sidebarFooter">
          ⚙ 设置
        </div>
      </aside>

      <main className="main">
        {rootView === "workbench" ? (
          <Workbench
            apps={apps}
            loading={loading}
            description={description}
            creating={creating}
            setDescription={setDescription}
            createApp={createApp}
            openApp={(item) => {
              setSelectedApp(item);
              setActivePage("overview");
            }}
          />
        ) : (
          <PlatformWorkspace
            view={rootView}
          />
        )}
      </main>
    </div>
  );
}

function Workbench({
  apps,
  loading,
  description,
  creating,
  setDescription,
  createApp,
  openApp
}: {
  apps: AppManifest[];
  loading: boolean;
  description: string;
  creating: boolean;
  setDescription: (value: string) => void;
  createApp: () => Promise<void>;
  openApp: (item: AppManifest) => void;
}) {
  return (
    <>
      <header>
        <div>
          <h1>企业 AI 工作台</h1>
          <p>
            用自然语言创建、运行和扩展属于自己的企业应用。
          </p>
        </div>

        <button
          className="createButton"
          onClick={() => {
            document
              .querySelector<HTMLInputElement>(
                ".promptBox input"
              )
              ?.focus();
          }}
        >
          ＋ 创建应用
        </button>
      </header>

      <section className="hero">
        <div className="heroLabel">
          AI APP BUILDER
        </div>

        <h2>
          你想为自己的企业做一个什么应用？
        </h2>

        <p>
          描述业务需求，AI 将帮助你完成需求分析、数据模型、页面、Agent、Skill、Workflow 和 Connector 设计。
        </p>

        <div className="promptBox">
          <input
            placeholder="例如：帮我做一个旅行社客户和订单管理系统……"
            value={description}
            onChange={(event) =>
              setDescription(
                event.target.value
              )
            }
            disabled={creating}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void createApp();
              }
            }}
          />

          <button
            onClick={() => void createApp()}
            disabled={creating}
          >
            {creating
              ? "AI 正在创建…"
              : "开始创建"}
          </button>
        </div>
      </section>

      <section className="stats">
        <div>
          <strong>{apps.length}</strong>
          <span>已安装应用</span>
        </div>
        <div>
          <strong>6</strong>
          <span>Package 类型</span>
        </div>
        <div>
          <strong>1</strong>
          <span>AI Runtime</span>
        </div>
        <div>
          <strong>Online</strong>
          <span>DeepSeek Harness</span>
        </div>
      </section>

      <section className="appsSection">
        <div className="sectionHeader">
          <div>
            <h3>我的应用</h3>
            <p>
              AI 创建或安装到当前平台的企业应用
            </p>
          </div>
        </div>

        {loading && (
          <div className="empty">
            正在加载应用……
          </div>
        )}

        <div className="appGrid">
          {apps.map((item) => (
            <article
              className="appCard"
              key={item.id}
            >
              <div className="appTop">
                <div className="appIcon">
                  {item.displayName?.[0] ?? item.name[0]}
                </div>
                <span className="status">
                  ● 已启用
                </span>
              </div>

              <h4>
                {item.displayName ?? item.name}
              </h4>

              <p className="description">
                {item.description}
              </p>

              <div className="appMeta">
                <span>
                  页面 {item.navigation?.length ?? 0}
                </span>
                <span>
                  角色 {item.metadata?.roles?.length ?? 0}
                </span>
                <span>
                  数据实体 {item.metadata?.entities?.length ?? 0}
                </span>
              </div>

              <div className="cardFooter">
                <span>v{item.version}</span>
                <button
                  onClick={() =>
                    openApp(item)
                  }
                >
                  打开应用 →
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

ReactDOM
  .createRoot(
    document.getElementById("root")!
  )
  .render(
    <React.StrictMode>
      <Platform />
    </React.StrictMode>
  );
