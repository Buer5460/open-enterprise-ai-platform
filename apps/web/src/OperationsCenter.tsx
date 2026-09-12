import React from "react";
import { apiFetch, apiUrl } from "./apiClient";
import "./OperationsCenter.css";

type Summary = {
  days: number;
  total: number;
  failures: number;
  aiCalls: number;
  fileActions: number;
  averageDurationMs: number;
  pendingApprovals: number;
  categories: Array<{ category: string; total: number }>;
  daily: Array<{ day: string; total: number; aiCalls: number; failures: number }>;
};

type Approval = {
  id: string;
  title: string;
  description?: string;
  actionType: string;
  payload?: unknown;
  status: "pending" | "approved" | "rejected" | "cancelled";
  createdBy: string;
  decidedBy?: string;
  decisionNote?: string;
  createdAt: string;
  decidedAt?: string;
};

type Event = {
  id: number;
  memberId?: string;
  category: string;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  createdAt: string;
};

const categoryLabels: Record<string, string> = {
  ai: "AI 调用",
  file: "文件",
  identity: "身份与成员",
  package: "Package",
  data: "业务数据",
  api: "其他 API"
};

const statusLabels: Record<Approval["status"], string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已拒绝",
  cancelled: "已撤销"
};

export function OperationsCenter() {
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [approvals, setApprovals] = React.useState<Approval[]>([]);
  const [events, setEvents] = React.useState<Event[]>([]);
  const [manager, setManager] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [message, setMessage] = React.useState("");
  const [status, setStatus] = React.useState<"all" | Approval["status"]>("all");
  const [form, setForm] = React.useState({
    title: "",
    description: "",
    actionType: "business.change",
    payload: ""
  });

  const load = React.useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const approvalQuery = status === "all"
        ? ""
        : `?status=${encodeURIComponent(status)}`;

      const [summaryResponse, approvalsResponse, eventsResponse] = await Promise.all([
        apiFetch(apiUrl("/api/operations/summary?days=30")),
        apiFetch(apiUrl(`/api/operations/approvals${approvalQuery}`)),
        apiFetch(apiUrl("/api/operations/events?limit=80"))
      ]);

      const [summaryResult, approvalResult, eventResult] = await Promise.all([
        summaryResponse.json(),
        approvalsResponse.json(),
        eventsResponse.json()
      ]);

      if (!summaryResponse.ok || !summaryResult.ok) {
        throw new Error(summaryResult.error || "运营数据加载失败");
      }
      if (!approvalsResponse.ok || !approvalResult.ok) {
        throw new Error(approvalResult.error || "审批列表加载失败");
      }
      if (!eventsResponse.ok || !eventResult.ok) {
        throw new Error(eventResult.error || "运行历史加载失败");
      }

      setSummary(summaryResult.summary);
      setApprovals(approvalResult.approvals || []);
      setEvents(eventResult.events || []);
      setManager(Boolean(summaryResult.manager));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "运营中心加载失败");
    } finally {
      setLoading(false);
    }
  }, [status]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function createApproval() {
    if (!form.title.trim() || !form.actionType.trim()) {
      setMessage("请填写审批标题和动作类型。");
      return;
    }

    let payload: unknown = undefined;
    if (form.payload.trim()) {
      try {
        payload = JSON.parse(form.payload);
      } catch {
        payload = { note: form.payload.trim() };
      }
    }

    const response = await apiFetch(apiUrl("/api/operations/approvals"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        description: form.description,
        actionType: form.actionType,
        payload
      })
    });
    const result = await response.json();

    if (!response.ok || !result.ok) {
      setMessage(result.error || "创建审批失败");
      return;
    }

    setForm({ title: "", description: "", actionType: "business.change", payload: "" });
    setMessage("审批请求已创建。");
    await load();
  }

  async function decide(id: string, decision: "approved" | "rejected") {
    const note = window.prompt(
      decision === "approved" ? "审批备注（可选）" : "拒绝原因（建议填写）",
      ""
    );
    if (note === null) return;

    const response = await apiFetch(
      apiUrl(`/api/operations/approvals/${encodeURIComponent(id)}/decision`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note })
      }
    );
    const result = await response.json();
    setMessage(response.ok && result.ok ? "审批状态已更新。" : result.error || "审批失败");
    if (response.ok && result.ok) await load();
  }

  async function cancel(id: string) {
    if (!window.confirm("确定撤销这条待审批请求吗？")) return;
    const response = await apiFetch(
      apiUrl(`/api/operations/approvals/${encodeURIComponent(id)}/cancel`),
      { method: "POST" }
    );
    const result = await response.json();
    setMessage(response.ok && result.ok ? "审批请求已撤销。" : result.error || "撤销失败");
    if (response.ok && result.ok) await load();
  }

  const failureRate = summary && summary.total > 0
    ? ((summary.failures / summary.total) * 100).toFixed(1)
    : "0.0";

  return (
    <section className="operationsCenter">
      <div className="operationsHeading">
        <div>
          <span>ENTERPRISE OPERATIONS</span>
          <h1>运营与审批中心</h1>
          <p>统一查看运行历史、AI 调用、失败事件与企业审批请求。管理员看到组织全量数据，普通成员只看到自己的活动。</p>
        </div>
        <div className="operationsRoleBadge">{manager ? "管理视图" : "成员视图"}</div>
      </div>

      {message && <div className="operationsMessage">{message}</div>}

      <div className="operationsStats">
        <Metric label="30 天请求" value={summary?.total ?? 0} />
        <Metric label="AI 调用" value={summary?.aiCalls ?? 0} />
        <Metric label="失败率" value={`${failureRate}%`} />
        <Metric label="平均耗时" value={`${summary?.averageDurationMs ?? 0} ms`} />
        <Metric label="待审批" value={summary?.pendingApprovals ?? 0} />
      </div>

      <div className="operationsGrid">
        <article className="operationsPanel approvalPanel">
          <div className="panelTitleRow">
            <div>
              <h2>审批中心</h2>
              <p>高风险或需要管理确认的业务动作可先形成审批请求。</p>
            </div>
            <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="all">全部状态</option>
              <option value="pending">待审批</option>
              <option value="approved">已批准</option>
              <option value="rejected">已拒绝</option>
              <option value="cancelled">已撤销</option>
            </select>
          </div>

          <div className="approvalComposer">
            <input
              value={form.title}
              placeholder="审批标题，例如：发布新的付款 Connector"
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            />
            <input
              value={form.actionType}
              placeholder="动作类型"
              onChange={(event) => setForm((current) => ({ ...current, actionType: event.target.value }))}
            />
            <textarea
              value={form.description}
              placeholder="说明为什么需要审批"
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
            <textarea
              value={form.payload}
              placeholder='可选：JSON 参数，例如 {"amount":1000}'
              onChange={(event) => setForm((current) => ({ ...current, payload: event.target.value }))}
            />
            <button onClick={() => void createApproval()}>＋ 创建审批请求</button>
          </div>

          <div className="approvalList">
            {approvals.map((item) => (
              <div className="approvalItem" key={item.id}>
                <div className="approvalItemTop">
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.actionType} · {formatTime(item.createdAt)}</small>
                  </div>
                  <span className={`approvalStatus ${item.status}`}>{statusLabels[item.status]}</span>
                </div>
                {item.description && <p>{item.description}</p>}
                {item.payload !== undefined && (
                  <pre>{safePretty(item.payload)}</pre>
                )}
                {item.decisionNote && <div className="decisionNote">备注：{item.decisionNote}</div>}
                {item.status === "pending" && (
                  <div className="approvalActions">
                    {manager && (
                      <>
                        <button className="approve" onClick={() => void decide(item.id, "approved")}>批准</button>
                        <button className="reject" onClick={() => void decide(item.id, "rejected")}>拒绝</button>
                      </>
                    )}
                    <button onClick={() => void cancel(item.id)}>撤销</button>
                  </div>
                )}
              </div>
            ))}
            {!loading && approvals.length === 0 && <div className="operationsEmpty">当前没有审批记录。</div>}
          </div>
        </article>

        <article className="operationsPanel">
          <h2>运行概况</h2>
          <p>过去 30 天按能力类型聚合的调用量。</p>
          <div className="categoryList">
            {(summary?.categories ?? []).map((item) => (
              <div key={item.category}>
                <span>{categoryLabels[item.category] || item.category}</span>
                <strong>{item.total}</strong>
              </div>
            ))}
          </div>
          <div className="dailyList">
            {(summary?.daily ?? []).slice(-14).map((item) => (
              <div key={item.day}>
                <span>{item.day.slice(5)}</span>
                <div className="dailyBar" title={`${item.total} 次`}>
                  <i style={{ width: `${Math.min(100, item.total * 8)}%` }} />
                </div>
                <small>{item.total}</small>
              </div>
            ))}
          </div>
        </article>
      </div>

      <article className="operationsPanel eventsPanel">
        <div className="panelTitleRow">
          <div>
            <h2>最近运行历史</h2>
            <p>请求状态、耗时、动作类型和成员维度的统一运行轨迹。</p>
          </div>
          <button className="refreshButton" onClick={() => void load()}>刷新</button>
        </div>
        <div className="eventsTableWrap">
          <table className="eventsTable">
            <thead>
              <tr><th>时间</th><th>分类</th><th>动作</th><th>状态</th><th>耗时</th><th>成员</th></tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatTime(event.createdAt)}</td>
                  <td>{categoryLabels[event.category] || event.category}</td>
                  <td><code>{event.action}</code></td>
                  <td><span className={event.statusCode >= 400 ? "eventFail" : "eventOk"}>{event.statusCode}</span></td>
                  <td>{event.durationMs} ms</td>
                  <td>{event.memberId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function safePretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
