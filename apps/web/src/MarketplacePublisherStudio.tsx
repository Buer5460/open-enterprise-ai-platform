import React from "react";
import { apiFetch, apiUrl } from "./apiClient";
import "./MarketplacePublisherStudio.css";

type Publisher = {
  publisherId: string;
  displayName: string;
  description?: string;
  website?: string;
  verified: boolean;
  status: string;
};

type Submission = {
  id: string;
  publisherId: string;
  packageId: string;
  status: "draft" | "submitted" | "approved" | "rejected";
  reviewNote?: string;
  listing: {
    slug: string;
    packageType: string;
    displayName: string;
    summary: string;
    latestVersion: string;
    categories?: string[];
    tags?: string[];
    pricing: Array<{
      id: string;
      name: string;
      model: string;
      currency?: string;
      amountMinor?: number;
      interval?: string;
    }>;
  };
};

export function MarketplacePublisherStudio() {
  const [publisher, setPublisher] = React.useState<Publisher | null>(null);
  const [submissions, setSubmissions] = React.useState<Submission[]>([]);
  const [reviewQueue, setReviewQueue] = React.useState<Submission[]>([]);
  const [reviewer, setReviewer] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [working, setWorking] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [profile, setProfile] = React.useState({
    publisherId: "",
    displayName: "",
    description: "",
    website: ""
  });
  const [draft, setDraft] = React.useState({
    slug: "",
    packageType: "agent",
    displayName: "",
    summary: "",
    latestVersion: "0.1.0",
    categories: "",
    tags: "",
    pricingModel: "free",
    currency: "USD",
    amount: "49"
  });

  const load = React.useCallback(async () => {
    setError("");
    const [accountResponse, submissionsResponse, reviewerResponse] =
      await Promise.all([
        apiFetch(apiUrl("/api/marketplace/v1/publisher/account")),
        apiFetch(apiUrl("/api/marketplace/v1/publisher/submissions")),
        apiFetch(apiUrl("/api/marketplace/v1/review/status"))
      ]);
    const [accountData, submissionsData, reviewerData] =
      await Promise.all([
        accountResponse.json(),
        submissionsResponse.json(),
        reviewerResponse.json()
      ]);

    if (!accountResponse.ok || !accountData.ok) {
      throw new Error(accountData.error || "发布者资料加载失败");
    }
    if (!submissionsResponse.ok || !submissionsData.ok) {
      throw new Error(submissionsData.error || "上架申请加载失败");
    }

    setPublisher(accountData.publisher ?? null);
    setSubmissions(submissionsData.submissions ?? []);
    setReviewer(Boolean(reviewerData.reviewer));

    if (accountData.publisher) {
      setProfile({
        publisherId: accountData.publisher.publisherId,
        displayName: accountData.publisher.displayName,
        description: accountData.publisher.description ?? "",
        website: accountData.publisher.website ?? ""
      });
    }

    if (reviewerData.reviewer) {
      const response = await apiFetch(
        apiUrl("/api/marketplace/v1/review/submissions")
      );
      const result = await response.json();
      if (response.ok && result.ok) {
        setReviewQueue(result.submissions ?? []);
      }
    } else {
      setReviewQueue([]);
    }
  }, []);

  React.useEffect(() => {
    load()
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "开发者商店加载失败"
        )
      )
      .finally(() => setLoading(false));
  }, [load]);

  async function saveProfile() {
    setWorking("profile");
    setError("");
    setMessage("");
    try {
      const response = await apiFetch(
        apiUrl("/api/marketplace/v1/publisher/account"),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profile)
        }
      );
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "发布者资料保存失败");
      }
      setMessage("发布者资料已保存。现在可以创建 Marketplace 商品。");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setWorking("");
    }
  }

  async function saveListing() {
    if (!draft.slug.trim()) {
      setError("请填写 Package slug。");
      return;
    }
    setWorking("listing");
    setError("");
    setMessage("");
    try {
      const pricing =
        draft.pricingModel === "free"
          ? [{ id: "free", name: "Free", model: "free" }]
          : [{
              id: "pro-monthly",
              name: "Pro Monthly",
              model: "subscription",
              currency: draft.currency.trim().toUpperCase() || "USD",
              amountMinor: Math.max(0, Math.round(Number(draft.amount || 0) * 100)),
              interval: "month"
            }];
      const response = await apiFetch(
        apiUrl(
          `/api/marketplace/v1/publisher/listings/${encodeURIComponent(
            draft.slug.trim()
          )}`
        ),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            packageType: draft.packageType,
            displayName: draft.displayName,
            summary: draft.summary,
            latestVersion: draft.latestVersion,
            categories: splitList(draft.categories),
            tags: splitList(draft.tags),
            pricing
          })
        }
      );
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Listing 保存失败");
      }
      setMessage(`草稿 ${result.submission.packageId} 已保存。`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Listing 保存失败");
    } finally {
      setWorking("");
    }
  }

  async function submit(item: Submission) {
    setWorking(item.packageId);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch(
        apiUrl(
          `/api/marketplace/v1/publisher/listings/${encodeURIComponent(
            item.listing.slug
          )}/submit`
        ),
        { method: "POST" }
      );
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "提交审核失败");
      }
      setMessage(`${item.listing.displayName} 已进入 Marketplace 审核队列。`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "提交审核失败");
    } finally {
      setWorking("");
    }
  }

  async function review(
    item: Submission,
    decision: "approve" | "reject"
  ) {
    setWorking(`review:${item.packageId}`);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch(
        apiUrl(
          `/api/marketplace/v1/review/submissions/${encodeURIComponent(
            item.packageId
          )}`
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            verifyPublisher: decision === "approve",
            note:
              decision === "approve"
                ? "Marketplace V1 review approved"
                : "Please revise listing metadata or package evidence"
          })
        }
      );
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "审核失败");
      }
      setMessage(
        decision === "approve"
          ? `${item.packageId} 已上架公开 Marketplace。`
          : `${item.packageId} 已退回修改。`
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "审核失败");
    } finally {
      setWorking("");
    }
  }

  if (loading) {
    return <section className="publisherStudio"><div className="publisherStudioEmpty">正在加载 Marketplace Developer Console…</div></section>;
  }

  return (
    <section className="publisherStudio">
      <div className="publisherStudioHero">
        <div>
          <span>MARKETPLACE DEVELOPER CONSOLE</span>
          <h1>开发者商店</h1>
          <p>创建发布者身份、定义商业价格、提交 Agent / Skill / Workflow / Connector，并进入平台审核后公开上架。</p>
        </div>
        <div className="publisherStudioStats">
          <strong>{submissions.length}</strong>
          <span>我的商品</span>
          <strong>{submissions.filter((item) => item.status === "approved").length}</strong>
          <span>已上架</span>
        </div>
      </div>

      {(message || error) && (
        <div className={error ? "publisherStudioMessage error" : "publisherStudioMessage"}>
          {error || message}
        </div>
      )}

      <div className="publisherStudioGrid">
        <article className="publisherStudioPanel">
          <h2>1. 发布者身份</h2>
          <label><span>Publisher ID</span><input disabled={Boolean(publisher)} value={profile.publisherId} onChange={(event) => setProfile((current) => ({ ...current, publisherId: event.target.value }))} placeholder="my-company" /></label>
          <label><span>显示名称</span><input value={profile.displayName} onChange={(event) => setProfile((current) => ({ ...current, displayName: event.target.value }))} placeholder="My Company" /></label>
          <label><span>官网</span><input value={profile.website} onChange={(event) => setProfile((current) => ({ ...current, website: event.target.value }))} placeholder="https://..." /></label>
          <label><span>简介</span><textarea value={profile.description} onChange={(event) => setProfile((current) => ({ ...current, description: event.target.value }))} /></label>
          <button disabled={working === "profile"} onClick={() => void saveProfile()}>{working === "profile" ? "保存中…" : "保存发布者资料"}</button>
          {publisher && <small>{publisher.verified ? "✓ 已验证发布者" : "未验证发布者 · 首次审核时可完成验证"}</small>}
        </article>

        <article className="publisherStudioPanel">
          <h2>2. 创建 Marketplace 商品</h2>
          <label><span>Slug</span><input value={draft.slug} onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))} placeholder="opportunity-radar-pro" /></label>
          <div className="publisherStudioTwo"><label><span>类型</span><select value={draft.packageType} onChange={(event) => setDraft((current) => ({ ...current, packageType: event.target.value }))}><option value="agent">Agent</option><option value="skill">Skill</option><option value="workflow">Workflow</option><option value="connector">Connector</option><option value="data-provider">Data Provider</option><option value="app">App</option></select></label><label><span>版本</span><input value={draft.latestVersion} onChange={(event) => setDraft((current) => ({ ...current, latestVersion: event.target.value }))} /></label></div>
          <label><span>商品名称</span><input value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
          <label><span>一句话价值</span><textarea value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} /></label>
          <div className="publisherStudioTwo"><label><span>分类，逗号分隔</span><input value={draft.categories} onChange={(event) => setDraft((current) => ({ ...current, categories: event.target.value }))} placeholder="sales,growth" /></label><label><span>标签，逗号分隔</span><input value={draft.tags} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="b2b,leads" /></label></div>
          <div className="publisherStudioTwo"><label><span>收费模式</span><select value={draft.pricingModel} onChange={(event) => setDraft((current) => ({ ...current, pricingModel: event.target.value }))}><option value="free">免费</option><option value="subscription">月订阅</option></select></label>{draft.pricingModel === "subscription" && <label><span>月费</span><input value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))} /></label>}</div>
          <button disabled={!publisher || working === "listing"} onClick={() => void saveListing()}>{working === "listing" ? "保存中…" : "保存商品草稿"}</button>
        </article>
      </div>

      <article className="publisherStudioPanel publisherStudioWide">
        <h2>3. 我的上架申请</h2>
        {submissions.length === 0 ? <p className="publisherStudioMuted">还没有 Marketplace 商品。</p> : <div className="publisherSubmissionList">{submissions.map((item) => <div className="publisherSubmission" key={item.packageId}><div><b>{item.listing.displayName}</b><code>{item.packageId}</code><small>{item.listing.packageType} · v{item.listing.latestVersion}</small>{item.reviewNote && <em>{item.reviewNote}</em>}</div><span className={`submissionStatus ${item.status}`}>{statusLabel(item.status)}</span>{(item.status === "draft" || item.status === "rejected") && <button disabled={working === item.packageId} onClick={() => void submit(item)}>提交审核</button>}</div>)}</div>}
      </article>

      {reviewer && (
        <article className="publisherStudioPanel publisherStudioWide reviewPanel">
          <h2>平台审核队列</h2>
          <p className="publisherStudioMuted">只有配置为 Marketplace Reviewer 的组织可见。生产环境必须显式配置审核组织。</p>
          {reviewQueue.length === 0 ? <p className="publisherStudioMuted">当前没有待审核商品。</p> : <div className="publisherSubmissionList">{reviewQueue.map((item) => <div className="publisherSubmission review" key={item.packageId}><div><b>{item.listing.displayName}</b><code>{item.packageId}</code><small>{item.listing.summary}</small></div><div className="reviewActions"><button disabled={working === `review:${item.packageId}`} onClick={() => void review(item, "approve")}>通过并上架</button><button className="danger" disabled={working === `review:${item.packageId}`} onClick={() => void review(item, "reject")}>退回修改</button></div></div>)}</div>}
        </article>
      )}
    </section>
  );
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function statusLabel(status: Submission["status"]): string {
  return ({
    draft: "草稿",
    submitted: "审核中",
    approved: "已上架",
    rejected: "已退回"
  })[status];
}
