import React from "react";

const API = "http://127.0.0.1:8787";

export type PlatformView =
  | "agents"
  | "skills"
  | "workflows"
  | "connectors"
  | "data"
  | "marketplace"
  | "developer";

type PackageType =
  | "app"
  | "agent"
  | "skill"
  | "workflow"
  | "connector"
  | "data-provider";

type MarketplacePackage = {
  id: string;
  type: PackageType;
  name: string;
  displayName: string;
  description?: string;
  version: string;
  publisher: string;
  source: "official" | "generated" | "developer";
  status: "available" | "enabled" | "draft";
  directory?: string;
  tags?: string[];
};

type CatalogResponse = {
  ok: boolean;
  packages: MarketplacePackage[];
  counts: Record<string, number>;
};

type DataOverview = {
  ok: boolean;
  totals: {
    apps: number;
    entities: number;
    records: number;
  };
  apps: Array<{
    id: string;
    name: string;
    version: string;
    entities: number;
    records: number;
    entityStats: Array<{
      name: string;
      description?: string;
      fields: number;
      records: number;
    }>;
  }>;
};

const titles: Record<Exclude<PlatformView, "data">, {
  title: string;
  subtitle: string;
}> = {
  agents: {
    title: "Agent 管理中心",
    subtitle:
      "管理面向具体业务目标的 AI 角色，以及它们所依赖的 Skills 和能力。"
  },
  skills: {
    title: "Skills 管理中心",
    subtitle:
      "沉淀企业 SOP、业务能力和可复用工具，让 Agent 通过统一能力接口调用。"
  },
  workflows: {
    title: "Workflow 管理中心",
    subtitle:
      "组合 Agent、Skill 和审批节点，形成可运行、可审计的企业流程。"
  },
  connectors: {
    title: "Connector 管理中心",
    subtitle:
      "把 MCP、SaaS、企业 API 和本地系统接入统一 Capability Registry。"
  },
  marketplace: {
    title: "OEAP Marketplace",
    subtitle:
      "浏览官方、AI 生成和开发者创建的 App、Agent、Skill、Workflow 与 Connector。"
  },
  developer: {
    title: "Developer Studio",
    subtitle:
      "从统一 OEAP Package 规范创建扩展包脚手架，逐步形成可发布的开发生态。"
  }
};

const typeForView: Partial<
  Record<PlatformView, PackageType>
> = {
  agents: "agent",
  skills: "skill",
  workflows: "workflow",
  connectors: "connector"
};

export function PlatformWorkspace({
  view
}: {
  view: PlatformView;
}) {
  const [catalog, setCatalog] =
    React.useState<CatalogResponse>({
      ok: true,
      packages: [],
      counts: {}
    });

  const [loading, setLoading] =
    React.useState(true);

  const [query, setQuery] =
    React.useState("");

  const [typeFilter, setTypeFilter] =
    React.useState<PackageType | "all">(
      "all"
    );

  const [workingPackage, setWorkingPackage] =
    React.useState<string | null>(null);

  const [actionMessage, setActionMessage] =
    React.useState("");

  const load = React.useCallback(async () => {
    const response = await fetch(
      `${API}/api/platform/packages`
    );

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(
        data.error ?? "平台包目录加载失败"
      );
    }

    setCatalog(data);
  }, []);

  React.useEffect(() => {
    if (view === "data") {
      return;
    }

    setLoading(true);
    load()
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [load, view]);

  async function togglePackage(
    item: MarketplacePackage
  ) {
    if (
      item.source !== "official" ||
      item.id === "oeap.deepseek-harness"
    ) {
      return;
    }

    const action =
      item.status === "enabled"
        ? "disable"
        : "enable";

    setWorkingPackage(item.id);
    setActionMessage("");

    try {
      const response = await fetch(
        `${API}/api/platform/packages/${encodeURIComponent(
          item.id
        )}/${action}`,
        {
          method: "POST"
        }
      );

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "Package 操作失败"
        );
      }

      setActionMessage(
        `${item.displayName} ${action === "enable" ? "已启用" : "已停用"}`
      );

      await load();
    } catch (error) {
      setActionMessage(
        error instanceof Error
          ? error.message
          : "Package 操作失败"
      );
    } finally {
      setWorkingPackage(null);
    }
  }

  if (view === "data") {
    return <DataCenter />;
  }

  if (view === "developer") {
    return (
      <DeveloperStudio
        packages={catalog.packages}
        onChanged={load}
      />
    );
  }

  const requestedType =
    typeForView[view];

  const normalizedQuery =
    query.trim().toLowerCase();

  const packages = catalog.packages.filter(
    (item) => {
      if (
        requestedType &&
        item.type !== requestedType
      ) {
        return false;
      }

      if (
        view === "marketplace" &&
        typeFilter !== "all" &&
        item.type !== typeFilter
      ) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [
        item.id,
        item.name,
        item.displayName,
        item.description,
        item.publisher,
        ...(item.tags ?? [])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    }
  );

  const heading = titles[view];

  return (
    <section className="platformWorkspace">
      <div className="workspaceHeading">
        <div>
          <span className="workspaceEyebrow">
            OEAP EXTENSIBILITY
          </span>
          <h1>{heading.title}</h1>
          <p>{heading.subtitle}</p>
        </div>

        <div className="workspaceMetric">
          <strong>{packages.length}</strong>
          <span>当前可见 Package</span>
        </div>
      </div>

      <div className="catalogToolbar">
        <input
          value={query}
          onChange={(event) =>
            setQuery(event.target.value)
          }
          placeholder="搜索名称、ID、能力或发布者…"
        />

        {view === "marketplace" && (
          <select
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(
                event.target.value as
                  | PackageType
                  | "all"
              )
            }
          >
            <option value="all">
              全部 Package 类型
            </option>
            <option value="app">App</option>
            <option value="agent">Agent</option>
            <option value="skill">Skill</option>
            <option value="workflow">
              Workflow
            </option>
            <option value="connector">
              Connector
            </option>
            <option value="data-provider">
              Data Provider
            </option>
          </select>
        )}
      </div>

      {actionMessage && (
        <div className="packageActionMessage">
          {actionMessage}
        </div>
      )}

      {view === "marketplace" && (
        <div className="catalogStats">
          {[
            ["app", "Apps"],
            ["agent", "Agents"],
            ["skill", "Skills"],
            ["workflow", "Workflows"],
            ["connector", "Connectors"],
            ["data-provider", "Data"]
          ].map(([type, label]) => (
            <div key={type}>
              <strong>
                {catalog.counts[type] ?? 0}
              </strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="workspaceEmpty">
          正在读取 OEAP Package 目录…
        </div>
      ) : (
        <PackageGrid
          packages={packages}
          workingPackage={workingPackage}
          onToggle={togglePackage}
        />
      )}
    </section>
  );
}

function DataCenter() {
  const [data, setData] =
    React.useState<DataOverview | null>(null);
  const [loading, setLoading] =
    React.useState(true);
  const [error, setError] =
    React.useState("");

  React.useEffect(() => {
    fetch(`${API}/api/platform/data-overview`)
      .then(async (response) => {
        const result = await response.json();

        if (!response.ok || !result.ok) {
          throw new Error(
            result.error ?? "数据中心加载失败"
          );
        }

        setData(result);
      })
      .catch((reason) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "数据中心加载失败"
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <section className="platformWorkspace">
      <div className="workspaceHeading">
        <div>
          <span className="workspaceEyebrow">
            ENTERPRISE DATA
          </span>
          <h1>数据中心</h1>
          <p>
            汇总 AI 生成应用的 SQLite 数据实体和记录量，为后续跨应用分析、BI 和数据权限奠定统一入口。
          </p>
        </div>

        <div className="workspaceMetric">
          <strong>
            {data?.totals.records ?? 0}
          </strong>
          <span>总业务记录</span>
        </div>
      </div>

      {loading ? (
        <div className="workspaceEmpty">
          正在统计应用数据…
        </div>
      ) : error ? (
        <div className="workspaceEmpty">
          {error}
        </div>
      ) : data ? (
        <>
          <div className="dataCenterStats">
            <div>
              <strong>{data.totals.apps}</strong>
              <span>应用</span>
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

          <div className="dataAppGrid">
            {data.apps.map((item) => (
              <article
                className="dataAppCard"
                key={item.id}
              >
                <div className="dataAppHeader">
                  <div>
                    <h3>{item.name}</h3>
                    <span>v{item.version}</span>
                  </div>
                  <strong>
                    {item.records} 条
                  </strong>
                </div>

                <div className="dataEntityList">
                  {item.entityStats.map(
                    (entity) => (
                      <div
                        key={entity.name}
                      >
                        <div>
                          <strong>
                            {entity.name}
                          </strong>
                          <small>
                            {entity.fields} 个字段
                          </small>
                        </div>
                        <span>
                          {entity.records} 条
                        </span>
                      </div>
                    )
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function PackageGrid({
  packages,
  workingPackage,
  onToggle
}: {
  packages: MarketplacePackage[];
  workingPackage: string | null;
  onToggle: (
    item: MarketplacePackage
  ) => Promise<void>;
}) {
  if (packages.length === 0) {
    return (
      <div className="workspaceEmpty">
        当前筛选条件下没有 Package。
      </div>
    );
  }

  return (
    <div className="packageGrid">
      {packages.map((item) => {
        const canToggle =
          item.source === "official" &&
          item.id !==
            "oeap.deepseek-harness";

        return (
          <article
            className="packageCard"
            key={`${item.source}:${item.id}`}
          >
            <div className="packageCardTop">
              <span
                className={`packageType packageType-${item.type}`}
              >
                {item.type}
              </span>

              <span
                className={`packageStatus packageStatus-${item.status}`}
              >
                {statusLabel(item.status)}
              </span>
            </div>

            <h3>{item.displayName}</h3>
            <code>{item.id}</code>

            <p>
              {item.description ??
                "OEAP 可扩展业务能力包。"}
            </p>

            <div className="packageTags">
              {(item.tags ?? [])
                .slice(0, 4)
                .map((tag) => (
                  <span key={tag}>
                    {tag}
                  </span>
                ))}
            </div>

            {canToggle ? (
              <button
                className={
                  item.status === "enabled"
                    ? "packageToggle packageToggleDanger"
                    : "packageToggle"
                }
                disabled={
                  workingPackage === item.id
                }
                onClick={() =>
                  void onToggle(item)
                }
              >
                {workingPackage === item.id
                  ? "处理中…"
                  : item.status === "enabled"
                    ? "停用 Package"
                    : "启用 Package"}
              </button>
            ) : item.id ===
              "oeap.deepseek-harness" ? (
              <div className="packageManagedHint">
                由 AI Runtime 启动配置管理
              </div>
            ) : null}

            <footer>
              <span>
                {item.publisher} · v{item.version}
              </span>
              <span>
                {sourceLabel(item.source)}
              </span>
            </footer>
          </article>
        );
      })}
    </div>
  );
}

function DeveloperStudio({
  packages,
  onChanged
}: {
  packages: MarketplacePackage[];
  onChanged: () => Promise<void>;
}) {
  const [type, setType] =
    React.useState<PackageType>("skill");
  const [name, setName] =
    React.useState("");
  const [displayName, setDisplayName] =
    React.useState("");
  const [description, setDescription] =
    React.useState("");
  const [publisher, setPublisher] =
    React.useState("local");
  const [working, setWorking] =
    React.useState(false);
  const [message, setMessage] =
    React.useState("");

  const drafts = packages.filter(
    (item) =>
      item.source === "developer"
  );

  async function createDraft() {
    if (!name.trim()) {
      setMessage("请填写 Package 名称。");
      return;
    }

    setWorking(true);
    setMessage("正在生成 OEAP Package 脚手架…");

    try {
      const response = await fetch(
        `${API}/api/developer/packages`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            type,
            name,
            displayName,
            description,
            publisher
          })
        }
      );

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "创建失败"
        );
      }

      setName("");
      setDisplayName("");
      setDescription("");
      setMessage(
        `已创建 ${result.package.id}，脚手架保存在 ${result.package.directory}`
      );
      await onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "创建失败"
      );
    } finally {
      setWorking(false);
    }
  }

  async function removeDraft(
    packageId: string
  ) {
    if (!window.confirm(
      `删除开发草稿 ${packageId}？`
    )) {
      return;
    }

    const response = await fetch(
      `${API}/api/developer/packages/${encodeURIComponent(
        packageId
      )}`,
      {
        method: "DELETE"
      }
    );

    const result = await response.json();

    if (!response.ok || !result.ok) {
      setMessage(
        result.error ?? "删除失败"
      );
      return;
    }

    setMessage(`已删除 ${packageId}`);
    await onChanged();
  }

  return (
    <section className="platformWorkspace">
      <div className="workspaceHeading">
        <div>
          <span className="workspaceEyebrow">
            PACKAGE BUILDER
          </span>
          <h1>Developer Studio</h1>
          <p>
            创建符合 OEAP Package 规范的 App、Agent、Skill、Workflow、Connector 和 Data Provider 脚手架。
          </p>
        </div>

        <div className="workspaceMetric">
          <strong>{drafts.length}</strong>
          <span>本地开发草稿</span>
        </div>
      </div>

      <div className="developerLayout">
        <article className="developerForm">
          <h3>创建 Package</h3>
          <p>
            先定义扩展类型和业务语义，平台会生成 manifest、源码入口和 README。
          </p>

          <label>
            <span>Package 类型</span>
            <select
              value={type}
              onChange={(event) =>
                setType(
                  event.target.value as PackageType
                )
              }
            >
              <option value="app">App</option>
              <option value="agent">Agent</option>
              <option value="skill">Skill</option>
              <option value="workflow">
                Workflow
              </option>
              <option value="connector">
                Connector
              </option>
              <option value="data-provider">
                Data Provider
              </option>
            </select>
          </label>

          <label>
            <span>名称（英文/Slug）</span>
            <input
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
              placeholder="customer-risk-skill"
            />
          </label>

          <label>
            <span>显示名称</span>
            <input
              value={displayName}
              onChange={(event) =>
                setDisplayName(
                  event.target.value
                )
              }
              placeholder="客户风险分析 Skill"
            />
          </label>

          <label>
            <span>Publisher</span>
            <input
              value={publisher}
              onChange={(event) =>
                setPublisher(
                  event.target.value
                )
              }
              placeholder="local"
            />
          </label>

          <label>
            <span>业务说明</span>
            <textarea
              value={description}
              onChange={(event) =>
                setDescription(
                  event.target.value
                )
              }
              rows={4}
              placeholder="这个 Package 解决什么企业问题？"
            />
          </label>

          <button
            className="developerCreateButton"
            disabled={working}
            onClick={() =>
              void createDraft()
            }
          >
            {working
              ? "生成中…"
              : "生成开发脚手架"}
          </button>

          {message && (
            <div className="developerMessage">
              {message}
            </div>
          )}
        </article>

        <article className="developerDrafts">
          <div className="developerDraftHeader">
            <div>
              <h3>开发草稿</h3>
              <p>
                草稿存储在本地 .tmp，不会自动提交 GitHub。
              </p>
            </div>
          </div>

          {drafts.length === 0 ? (
            <div className="workspaceEmpty compact">
              还没有开发草稿。
            </div>
          ) : (
            drafts.map((item) => (
              <div
                className="developerDraftItem"
                key={item.id}
              >
                <div>
                  <strong>
                    {item.displayName}
                  </strong>
                  <code>{item.id}</code>
                  <small>
                    {item.type} · {item.directory}
                  </small>
                </div>

                <button
                  onClick={() =>
                    void removeDraft(
                      item.id
                    )
                  }
                >
                  删除
                </button>
              </div>
            ))
          )}
        </article>
      </div>
    </section>
  );
}

function statusLabel(
  status: MarketplacePackage["status"]
) {
  if (status === "enabled") {
    return "已启用";
  }
  if (status === "draft") {
    return "草稿";
  }
  return "可用";
}

function sourceLabel(
  source: MarketplacePackage["source"]
) {
  if (source === "official") {
    return "官方";
  }
  if (source === "generated") {
    return "AI 生成";
  }
  return "Developer Studio";
}
