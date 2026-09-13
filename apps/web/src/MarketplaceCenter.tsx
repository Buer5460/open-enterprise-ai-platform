import React from "react";
import {
  apiFetch,
  apiUrl
} from "./apiClient";
import "./MarketplaceCenter.css";

type PackageType =
  | "app"
  | "agent"
  | "skill"
  | "workflow"
  | "connector"
  | "data-provider";

type PricingModel =
  | "free"
  | "one-time"
  | "subscription"
  | "metered"
  | "contact-sales";

type PricingPlan = {
  id: string;
  name: string;
  model: PricingModel;
  description?: string;
  currency?: string;
  amountMinor?: number;
  interval?: "month" | "year";
  unit?: string;
  includedUnits?: number;
  trialDays?: number;
};

type MarketplaceListing = {
  id: string;
  packageId: string;
  packageType: PackageType;
  slug: string;
  displayName: string;
  summary: string;
  publisherId: string;
  latestVersion: string;
  tags?: string[];
  categories?: string[];
  pricing: PricingPlan[];
  license?: {
    model: string;
    spdxId?: string;
  };
  verified?: boolean;
  installCount?: number;
  rating?: {
    average: number;
    count: number;
  };
};

type Entitlement = {
  id: string;
  packageId: string;
  planId: string;
  pricingModel: PricingModel;
  status: "active" | "cancelled" | "expired";
  acquiredAt: string;
  updatedAt: string;
};

type Order = {
  id: string;
  packageId: string;
  planId: string;
  status: string;
  currency?: string;
  amountMinor?: number;
};

const packageTypes: Array<{
  value: PackageType | "all";
  label: string;
}> = [
  { value: "all", label: "全部" },
  { value: "agent", label: "Agent" },
  { value: "skill", label: "Skill" },
  { value: "workflow", label: "Workflow" },
  { value: "connector", label: "Connector" },
  { value: "data-provider", label: "Data" },
  { value: "app", label: "App" }
];

export function MarketplaceCenter() {
  const [listings, setListings] =
    React.useState<MarketplaceListing[]>([]);
  const [entitlements, setEntitlements] =
    React.useState<Entitlement[]>([]);
  const [orders, setOrders] =
    React.useState<Order[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [type, setType] =
    React.useState<PackageType | "all">("all");
  const [category, setCategory] =
    React.useState("all");
  const [selected, setSelected] =
    React.useState<MarketplaceListing | null>(null);
  const [working, setWorking] =
    React.useState<string | null>(null);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setError("");

    const [listingResponse, entitlementResponse, orderResponse] =
      await Promise.all([
        apiFetch(apiUrl("/api/marketplace/v1/listings?limit=100")),
        apiFetch(apiUrl("/api/marketplace/v1/entitlements")),
        apiFetch(apiUrl("/api/marketplace/v1/orders"))
      ]);

    const [listingData, entitlementData, orderData] =
      await Promise.all([
        listingResponse.json(),
        entitlementResponse.json(),
        orderResponse.json()
      ]);

    if (!listingResponse.ok || !listingData.ok) {
      throw new Error(
        listingData.error ?? "Marketplace 加载失败"
      );
    }

    if (!entitlementResponse.ok || !entitlementData.ok) {
      throw new Error(
        entitlementData.error ?? "订阅权益加载失败"
      );
    }

    if (!orderResponse.ok || !orderData.ok) {
      throw new Error(
        orderData.error ?? "订单加载失败"
      );
    }

    setListings(listingData.items ?? []);
    setEntitlements(entitlementData.entitlements ?? []);
    setOrders(orderData.orders ?? []);
  }, []);

  React.useEffect(() => {
    load()
      .catch((reason) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "Marketplace 加载失败"
        );
      })
      .finally(() => setLoading(false));
  }, [load]);

  const categories = React.useMemo(() => {
    return [
      "all",
      ...Array.from(
        new Set(
          listings.flatMap(
            (item) => item.categories ?? []
          )
        )
      ).sort()
    ];
  }, [listings]);

  const activeEntitlements = React.useMemo(() => {
    return new Map(
      entitlements
        .filter((item) => item.status === "active")
        .map((item) => [item.packageId, item])
    );
  }, [entitlements]);

  const pendingOrders = React.useMemo(() => {
    return new Map(
      orders
        .filter((item) => item.status === "pending")
        .map((item) => [item.packageId, item])
    );
  }, [orders]);

  const filtered = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return listings.filter((item) => {
      if (type !== "all" && item.packageType !== type) {
        return false;
      }

      if (
        category !== "all" &&
        !(item.categories ?? []).includes(category)
      ) {
        return false;
      }

      if (!normalized) {
        return true;
      }

      return [
        item.packageId,
        item.displayName,
        item.summary,
        item.publisherId,
        ...(item.tags ?? []),
        ...(item.categories ?? [])
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [listings, query, type, category]);

  async function acquire(
    item: MarketplaceListing,
    plan: PricingPlan
  ) {
    setWorking(item.packageId);
    setMessage("");
    setError("");

    try {
      const response = await apiFetch(
        apiUrl(
          `/api/marketplace/v1/listings/${encodeURIComponent(
            item.packageId
          )}/acquire`
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            planId: plan.id
          })
        }
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "添加 Package 失败"
        );
      }

      if (result.entitlement) {
        setMessage(
          `「${item.displayName}」已添加到当前企业工作区。`
        );
      } else if (result.requiresContact) {
        setMessage(
          `「${item.displayName}」需要联系销售后开通。`
        );
      } else if (result.paymentRequired) {
        setMessage(
          `订单 ${result.order?.id ?? ""} 已创建；支付通道配置完成后即可继续付款。`
        );
      }

      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "添加 Package 失败"
      );
    } finally {
      setWorking(null);
    }
  }

  const ownedCount = activeEntitlements.size;

  return (
    <section className="marketplaceCenter">
      <div className="marketplaceHero">
        <div>
          <span className="marketplaceEyebrow">
            AGENT CAPABILITY MARKET
          </span>
          <h1>Agent Marketplace</h1>
          <p>
            发现、购买和组合 Agent、Skill、Workflow、Connector 与专业数据能力。
          </p>
        </div>

        <div className="marketplaceHeroStats">
          <div>
            <strong>{listings.length}</strong>
            <span>上架能力</span>
          </div>
          <div>
            <strong>{ownedCount}</strong>
            <span>已添加</span>
          </div>
          <div>
            <strong>
              {listings.filter((item) => item.verified).length}
            </strong>
            <span>已验证</span>
          </div>
        </div>
      </div>

      <div className="marketplaceSearchRow">
        <div className="marketplaceSearchBox">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) =>
              setQuery(event.target.value)
            }
            placeholder="搜索：获客、商业分析、投资研究、CRM…"
          />
        </div>

        <select
          value={type}
          onChange={(event) =>
            setType(
              event.target.value as PackageType | "all"
            )
          }
        >
          {packageTypes.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="marketplaceCategories">
        {categories.map((item) => (
          <button
            key={item}
            className={category === item ? "active" : ""}
            onClick={() => setCategory(item)}
          >
            {item === "all" ? "全部分类" : categoryLabel(item)}
          </button>
        ))}
      </div>

      {(message || error) && (
        <div
          className={
            error
              ? "marketplaceNotice marketplaceNoticeError"
              : "marketplaceNotice"
          }
        >
          {error || message}
        </div>
      )}

      {loading ? (
        <div className="marketplaceEmpty">
          正在读取 Marketplace…
        </div>
      ) : filtered.length === 0 ? (
        <div className="marketplaceEmpty">
          当前条件下没有匹配的 Package。
        </div>
      ) : (
        <div className="marketplaceGrid">
          {filtered.map((item) => {
            const primaryPlan = item.pricing[0];
            const entitlement = activeEntitlements.get(
              item.packageId
            );
            const pending = pendingOrders.get(item.packageId);

            return (
              <article
                className="marketplaceCard"
                key={item.packageId}
              >
                <div className="marketplaceCardTop">
                  <span className="marketplaceType">
                    {item.packageType}
                  </span>
                  {item.verified && (
                    <span className="marketplaceVerified">
                      ✓ 官方验证
                    </span>
                  )}
                </div>

                <button
                  className="marketplaceCardTitle"
                  onClick={() => setSelected(item)}
                >
                  {item.displayName}
                </button>
                <p>{item.summary}</p>

                <div className="marketplaceTagRow">
                  {(item.tags ?? []).slice(0, 3).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>

                <div className="marketplacePriceRow">
                  <strong>
                    {primaryPlan
                      ? formatPrice(primaryPlan)
                      : "暂无价格"}
                  </strong>
                  <small>v{item.latestVersion}</small>
                </div>

                <div className="marketplaceCardActions">
                  <button
                    className="marketplaceSecondary"
                    onClick={() => setSelected(item)}
                  >
                    查看详情
                  </button>
                  <button
                    className="marketplacePrimary"
                    disabled={
                      !primaryPlan ||
                      Boolean(entitlement) ||
                      working === item.packageId
                    }
                    onClick={() =>
                      primaryPlan && void acquire(item, primaryPlan)
                    }
                  >
                    {working === item.packageId
                      ? "处理中…"
                      : entitlement
                        ? "已添加"
                        : pending
                          ? "订单待支付"
                          : primaryPlan?.model === "free"
                            ? "免费添加"
                            : primaryPlan?.model === "contact-sales"
                              ? "联系销售"
                              : "购买"}
                  </button>
                </div>

                <footer>
                  <span>{item.publisherId}</span>
                  <span>
                    ★ {(item.rating?.average ?? 0).toFixed(1)} · {item.installCount ?? 0} 安装
                  </span>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {selected && (
        <div
          className="marketplaceDrawerBackdrop"
          onClick={() => setSelected(null)}
        >
          <aside
            className="marketplaceDrawer"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="marketplaceDrawerClose"
              onClick={() => setSelected(null)}
              aria-label="关闭"
            >
              ×
            </button>

            <span className="marketplaceType">
              {selected.packageType}
            </span>
            <h2>{selected.displayName}</h2>
            <code>{selected.packageId}</code>
            <p>{selected.summary}</p>

            <dl>
              <div>
                <dt>发布者</dt>
                <dd>
                  {selected.publisherId}
                  {selected.verified ? " · 已验证" : ""}
                </dd>
              </div>
              <div>
                <dt>版本</dt>
                <dd>{selected.latestVersion}</dd>
              </div>
              <div>
                <dt>许可</dt>
                <dd>
                  {selected.license?.spdxId ??
                    selected.license?.model ??
                    "未声明"}
                </dd>
              </div>
            </dl>

            <h3>价格方案</h3>
            <div className="marketplacePlans">
              {selected.pricing.map((plan) => (
                <div key={plan.id}>
                  <div>
                    <strong>{plan.name}</strong>
                    <span>{formatPrice(plan)}</span>
                  </div>
                  {plan.description && <p>{plan.description}</p>}
                  <button
                    className="marketplacePrimary"
                    disabled={
                      activeEntitlements.has(selected.packageId) ||
                      working === selected.packageId
                    }
                    onClick={() => void acquire(selected, plan)}
                  >
                    {activeEntitlements.has(selected.packageId)
                      ? "已添加"
                      : plan.model === "free"
                        ? "免费添加"
                        : plan.model === "contact-sales"
                          ? "联系销售"
                          : "创建购买订单"}
                  </button>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

function formatPrice(plan: PricingPlan): string {
  if (plan.model === "free") {
    return "免费";
  }

  if (plan.model === "contact-sales") {
    return "联系销售";
  }

  if (
    plan.amountMinor === undefined ||
    !plan.currency
  ) {
    return plan.name;
  }

  const amount = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: plan.currency,
    maximumFractionDigits: 2
  }).format(plan.amountMinor / 100);

  if (plan.model === "subscription") {
    return `${amount}/${plan.interval === "year" ? "年" : "月"}`;
  }

  if (plan.model === "metered") {
    return `${amount}/${plan.unit ?? "次"}`;
  }

  return amount;
}

function categoryLabel(value: string): string {
  const labels: Record<string, string> = {
    research: "研究",
    "business-intelligence": "商业情报",
    sales: "销售获客",
    growth: "增长",
    strategy: "商业分析",
    investment: "投资研究"
  };

  return labels[value] ?? value;
}
