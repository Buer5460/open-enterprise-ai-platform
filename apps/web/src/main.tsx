import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

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
    roles?: unknown[];
    entities?: unknown[];
    workflows?: unknown[];
  };
};

function Platform() {
  const [apps, setApps] =
    React.useState<AppManifest[]>([]);

  const [loading, setLoading] =
    React.useState(true);

  React.useEffect(() => {
    fetch(
      "http://127.0.0.1:8787/api/apps"
    )
      .then((response) => response.json())
      .then((data) => {
        setApps(data.apps ?? []);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

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
          <button className="active">
            ◫ 工作台
          </button>

          <button>
            ◈ 我的应用
          </button>

          <button>
            ◎ Agent
          </button>

          <button>
            ◆ Skills
          </button>

          <button>
            ⇄ Workflows
          </button>

          <button>
            ⌘ Connectors
          </button>

          <button>
            ▦ 数据中心
          </button>

          <div className="navDivider" />

          <button>
            ◇ Marketplace
          </button>

          <button>
            &lt;/&gt; Developer
          </button>
        </nav>

        <div className="sidebarFooter">
          ⚙ 设置
        </div>
      </aside>

      <main className="main">

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
              alert(
                "下一阶段将接入 AI App Builder"
              );
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
            描述业务需求，AI 将帮助你完成需求分析、数据模型、
            页面、Agent、Skill、Workflow 和 Connector 设计。
          </p>

          <div className="promptBox">
            <input
              placeholder="例如：帮我做一个旅行社客户和订单管理系统……"
              disabled
            />

            <button>
              开始创建
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

          {!loading && apps.length === 0 && (
            <div className="empty">
              暂时没有应用。
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
                    {item.displayName?.[0] ??
                      item.name[0]}
                  </div>

                  <span className="status">
                    ● 已启用
                  </span>
                </div>

                <h4>
                  {item.displayName ??
                    item.name}
                </h4>

                <p className="description">
                  {item.description ??
                    "OEAP 企业应用"}
                </p>

                <div className="appMeta">
                  <span>
                    页面{" "}
                    {item.navigation?.length ??
                      0}
                  </span>

                  <span>
                    角色{" "}
                    {item.metadata?.roles
                      ?.length ?? 0}
                  </span>

                  <span>
                    数据实体{" "}
                    {item.metadata?.entities
                      ?.length ?? 0}
                  </span>
                </div>

                <div className="cardFooter">
                  <span>
                    v{item.version}
                  </span>

                  <button>
                    打开应用 →
                  </button>
                </div>
              </article>
            ))}
          </div>

        </section>

      </main>

    </div>
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
