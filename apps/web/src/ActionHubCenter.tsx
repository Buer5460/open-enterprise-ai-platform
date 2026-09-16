import React from "react";
import {
  apiFetch,
  apiUrl
} from "./apiClient";
import "./ActionHubCenter.css";

type Risk = "R0" | "R1" | "R2" | "R3";
type Adapter =
  | "mcp"
  | "openapi"
  | "apple-app-intents"
  | "android-appfunctions"
  | "huawei-celia"
  | "xiaomi-agent"
  | "honor-yoyo";

type ActionDefinition = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  capability: string;
  permissionAction: string;
  risk: Risk;
  enabled: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

type Approval = {
  id: string;
  actionId: string;
  actionDisplayName: string;
  risk: Risk;
  input: unknown;
  status: string;
  createdAt: string;
  memberId: string;
  error?: string;
};

type EventItem = {
  id: string;
  actionId: string;
  status: string;
  createdAt: string;
  durationMs?: number;
  error?: string;
};

type Summary = {
  actions: number;
  enabledActions: number;
  pendingApprovals: number;
  executions24h: number;
  adapters: number;
};

type Compilation = {
  adapter: Adapter;
  actionId: string;
  artifact: Record<string, unknown>;
  source?: string;
  requiresVendorAuthorization: boolean;
  notes: string[];
};

const adapters: Array<{ id: Adapter; label: string }> = [
  { id: "mcp", label: "MCP" },
  { id: "openapi", label: "OpenAPI" },
  { id: "apple-app-intents", label: "Apple App Intents" },
  { id: "android-appfunctions", label: "Android AppFunctions" },
  { id: "huawei-celia", label: "华为小艺" },
  { id: "xiaomi-agent", label: "小米 Agent" },
  { id: "honor-yoyo", label: "荣耀 YOYO" }
];

const sampleAction: ActionDefinition = {
  id: "crm.customer.search",
  version: "1.0.0",
  displayName: "查询客户",
  description: "按关键字查询企业 CRM 客户。",
  capability: "crm.customer.search",
  permissionAction: "crm.read",
  risk: "R0",
  enabled: false,
  inputSchema: {
    type: "object",
    required: ["keyword"],
    properties: {
      keyword: { type: "string" },
      limit: { type: "integer" }
    }
  },
  tags: ["crm"]
};

export function ActionHubCenter() {
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [manager, setManager] = React.useState(false);
  const [actions, setActions] = React.useState<ActionDefinition[]>([]);
  const [approvals, setApprovals] = React.useState<Approval[]>([]);
  const [events, setEvents] = React.useState<EventItem[]>([]);
  const [tab, setTab] = React.useState<"actions" | "approvals" | "adapters" | "events">("actions");
  const [selectedActionId, setSelectedActionId] = React.useState("ai.generate");
  const [payload, setPayload] = React.useState('{\n  "prompt": "只回复 ACTION_HUB_OK"\n}');
  const [editor, setEditor] = React.useState(JSON.stringify(sampleAction, null, 2));
  const [adapter, setAdapter] = React.useState<Adapter>("mcp");
  const [compilation, setCompilation] = React.useState<Compilation | null>(null);
  const [result, setResult] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [working, setWorking] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResponse, actionResponse, approvalResponse, eventResponse] = await Promise.all([
        apiFetch(apiUrl("/api/action-hub/summary")),
        apiFetch(apiUrl("/api/action-hub/actions")),
        apiFetch(apiUrl("/api/action-hub/approvals?limit=100")),
        apiFetch(apiUrl("/api/action-hub/events?limit=100"))
      ]);
      const [summaryResult, actionResult, approvalResult, eventResult] = await Promise.all([
        summaryResponse.json(),
        actionResponse.json(),
        approvalResponse.json(),
        eventResponse.json()
      ]);

      if (!summaryResponse.ok || !summaryResult.ok) {
        throw new Error(summaryResult.error ?? "Action Hub 状态加载失败");
      }
      if (!actionResponse.ok || !actionResult.ok) {
        throw new Error(actionResult.error ?? "Universal Actions 加载失败");
      }

      setSummary(summaryResult.summary);
      setManager(Boolean(summaryResult.manager));
      setActions(actionResult.actions ?? []);
      setApprovals(approvalResult.approvals ?? []);
      setEvents(eventResult.events ?? []);

      const first = (actionResult.actions ?? [])[0] as ActionDefinition | undefined;
      if (first && !(actionResult.actions ?? []).some((item: ActionDefinition) => item.id === selectedActionId)) {
        setSelectedActionId(first.id);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedActionId]);

  React.useEffect(() => {
    void load().catch((error) => {
      setResult(error instanceof Error ? error.message : "Action Hub 加载失败");
    });
  }, [load]);

  const selectedAction = actions.find((item) => item.id === selectedActionId);

  async function executeAction() {
    if (!selectedAction) return;
    setWorking(true);
    setResult("");
    try {
      const parsed = JSON.parse(payload || "{}");
      const response = await apiFetch(
        apiUrl(`/api/action-hub/actions/${encodeURIComponent(selectedAction.id)}/execute`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: parsed })
        }
      );
      const body = await response.json();
      setResult(JSON.stringify(body, null, 2));
      await load();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Action 执行失败");
    } finally {
      setWorking(false);
    }
  }

  async function saveDefinition() {
    if (!manager) return;
    setWorking(true);
    setResult("");
    try {
      const definition = JSON.parse(editor) as ActionDefinition;
      if (!definition.id) throw new Error("Action id 不能为空");
      const response = await apiFetch(
        apiUrl(`/api/action-hub/actions/${encodeURIComponent(definition.id)}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(definition)
        }
      );
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "保存失败");
      }
      setResult(`已保存 ${definition.id}`);
      setSelectedActionId(definition.id);
      await load();
    } catch (error) {
      setResult(error instanceof Error ? error.message : "保存失败");
    } finally {
      setWorking(false);
    }
  }

  async function decide(approval: Approval, decision: "approved" | "rejected") {
    if (!manager) return;
    let confirmation: string | undefined;
    if (decision === "approved" && approval.risk === "R3") {
      confirmation = window.prompt(
        `高风险操作。请输入 Action ID 确认：${approval.actionId}`
      ) ?? undefined;
      if (!confirmation) return;
    }

    setWorking(true);
    try {
      const response = await apiFetch(
        apiUrl(`/api/action-hub/approvals/${encodeURIComponent(approval.id)}/decision`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, confirmation })
        }
      );
      const body = await response.json();
      setResult(JSON.stringify(body, null, 2));
      await load();
    } finally {
      setWorking(false);
    }
  }

  async function loadAdapter() {
    if (!selectedAction) return;
    setWorking(true);
    try {
      const response = await apiFetch(
        apiUrl(`/api/action-hub/actions/${encodeURIComponent(selectedAction.id)}/adapters?adapter=${encodeURIComponent(adapter)}`)
      );
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "Adapter 生成失败");
      }
      setCompilation(body.compilations?.[0] ?? null);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Adapter 生成失败");
    } finally {
      setWorking(false);
    }
  }

  function editAction(action: ActionDefinition) {
    setEditor(JSON.stringify(action, null, 2));
    setSelectedActionId(action.id);
    setTab("actions");
    setResult(`已载入 ${action.id} 到定义编辑器`);
  }

  return (
    <section className="actionHubCenter">
      <div className="actionHubHeading">
        <div>
          <span>AI ACTION HUB · UNIVERSAL ACTIONS</span>
          <h1>AI 执行中台</h1>
          <p>
            一次定义业务能力，通过统一风险、审批与审计层，对外生成 MCP、OpenAPI、Apple、Android、华为、小米和荣耀适配契约。
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading}>刷新</button>
      </div>

      <div className="actionHubMetrics">
        <Metric label="Universal Actions" value={summary?.actions ?? 0} />
        <Metric label="已启用" value={summary?.enabledActions ?? 0} />
        <Metric label="待审批" value={summary?.pendingApprovals ?? 0} />
        <Metric label="24h 执行" value={summary?.executions24h ?? 0} />
        <Metric label="Adapter" value={summary?.adapters ?? 7} />
      </div>

      <div className="actionHubEndpoints">
        <code>MCP /api/action-hub/mcp</code>
        <code>OpenAPI /api/action-hub/openapi.json</code>
        <span>{manager ? "管理员模式" : "成员只读模式"}</span>
      </div>

      <div className="actionHubTabs">
        <button className={tab === "actions" ? "active" : ""} onClick={() => setTab("actions")}>Actions</button>
        <button className={tab === "approvals" ? "active" : ""} onClick={() => setTab("approvals")}>审批</button>
        <button className={tab === "adapters" ? "active" : ""} onClick={() => setTab("adapters")}>多端 Adapter</button>
        <button className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>执行审计</button>
      </div>

      {tab === "actions" && (
        <div className="actionHubGrid">
          <article className="actionHubPanel">
            <div className="actionHubPanelTitle">
              <div><h3>Universal Actions</h3><p>R0 查询 · R1 低风险写入 · R2 审批 · R3 强确认审批</p></div>
            </div>
            <div className="actionList">
              {actions.map((action) => (
                <button
                  key={action.id}
                  className={`actionItem ${selectedActionId === action.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedActionId(action.id);
                    setPayload(defaultPayload(action));
                  }}
                >
                  <div>
                    <strong>{action.displayName}</strong>
                    <small>{action.id}</small>
                  </div>
                  <span className={`risk ${action.risk.toLowerCase()}`}>{action.risk}</span>
                  <em>{action.enabled ? "启用" : "停用"}</em>
                </button>
              ))}
            </div>
          </article>

          <article className="actionHubPanel">
            <div className="actionHubPanelTitle">
              <div><h3>{selectedAction?.displayName ?? "选择 Action"}</h3><p>{selectedAction?.description}</p></div>
              {selectedAction && manager && <button onClick={() => editAction(selectedAction)}>编辑定义</button>}
            </div>
            {selectedAction && (
              <>
                <div className="actionFacts">
                  <span><b>Capability</b>{selectedAction.capability}</span>
                  <span><b>Permission</b>{selectedAction.permissionAction}</span>
                  <span><b>Risk</b>{selectedAction.risk}</span>
                </div>
                <label className="jsonField">
                  <span>测试输入 JSON</span>
                  <textarea value={payload} onChange={(event) => setPayload(event.target.value)} />
                </label>
                <button className="actionPrimary" disabled={working || !selectedAction.enabled} onClick={() => void executeAction()}>
                  {working ? "执行中…" : selectedAction.enabled ? "执行 Action" : "Action 已停用"}
                </button>
              </>
            )}
          </article>

          <article className="actionHubPanel actionEditor">
            <div className="actionHubPanelTitle">
              <div><h3>UAS 定义编辑器</h3><p>Schema-first；保存后即可被 REST / MCP / 手机 Adapter 复用。</p></div>
            </div>
            <textarea value={editor} onChange={(event) => setEditor(event.target.value)} disabled={!manager} />
            <button className="actionPrimary" disabled={!manager || working} onClick={() => void saveDefinition()}>
              {manager ? "保存 Universal Action" : "仅管理员可修改"}
            </button>
          </article>
        </div>
      )}

      {tab === "approvals" && (
        <div className="actionHubPanel">
          <div className="actionHubPanelTitle"><div><h3>企业审批队列</h3><p>R2/R3 Action 不会绕过审批直接执行。</p></div></div>
          <div className="approvalList">
            {approvals.length === 0 && <p className="emptyState">暂无审批记录</p>}
            {approvals.map((approval) => (
              <div className="approvalItem" key={approval.id}>
                <div>
                  <strong>{approval.actionDisplayName}</strong>
                  <small>{approval.actionId} · {approval.memberId}</small>
                  <pre>{JSON.stringify(approval.input, null, 2)}</pre>
                </div>
                <div className="approvalMeta">
                  <span className={`risk ${approval.risk.toLowerCase()}`}>{approval.risk}</span>
                  <b>{approval.status}</b>
                  <small>{formatDate(approval.createdAt)}</small>
                  {manager && approval.status === "pending" && (
                    <div className="approvalActions">
                      <button onClick={() => void decide(approval, "rejected")}>拒绝</button>
                      <button className="actionPrimary" onClick={() => void decide(approval, "approved")}>批准并执行</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "adapters" && (
        <div className="actionHubGrid adapterGrid">
          <article className="actionHubPanel">
            <h3>选择 Action 与目标入口</h3>
            <label>
              <span>Universal Action</span>
              <select value={selectedActionId} onChange={(event) => setSelectedActionId(event.target.value)}>
                {actions.map((action) => <option value={action.id} key={action.id}>{action.displayName} · {action.id}</option>)}
              </select>
            </label>
            <label>
              <span>Adapter</span>
              <select value={adapter} onChange={(event) => setAdapter(event.target.value as Adapter)}>
                {adapters.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
              </select>
            </label>
            <button className="actionPrimary" disabled={working} onClick={() => void loadAdapter()}>生成 Adapter</button>
          </article>
          <article className="actionHubPanel adapterOutput">
            <div className="actionHubPanelTitle">
              <div><h3>生成结果</h3><p>{compilation?.requiresVendorAuthorization ? "代码/契约已生成；正式发布仍需厂商开发者账号授权。" : "可直接用于平台/API 集成。"}</p></div>
              {compilation && <button onClick={() => void navigator.clipboard?.writeText(compilation.source || JSON.stringify(compilation.artifact, null, 2))}>复制</button>}
            </div>
            <pre>{compilation ? (compilation.source || JSON.stringify(compilation.artifact, null, 2)) : "选择目标后点击“生成 Adapter”"}</pre>
            {compilation?.notes?.map((note) => <p className="adapterNote" key={note}>{note}</p>)}
          </article>
        </div>
      )}

      {tab === "events" && (
        <div className="actionHubPanel">
          <div className="actionHubPanelTitle"><div><h3>执行审计</h3><p>记录动作、结果、耗时与审批关联，不把业务输入复制进普通事件日志。</p></div></div>
          <div className="eventTable">
            {events.map((event) => (
              <div className="eventRow" key={event.id}>
                <strong>{event.actionId}</strong>
                <span>{event.status}</span>
                <span>{event.durationMs === undefined ? "-" : `${event.durationMs} ms`}</span>
                <span>{formatDate(event.createdAt)}</span>
                <small>{event.error ?? ""}</small>
              </div>
            ))}
            {events.length === 0 && <p className="emptyState">暂无执行记录</p>}
          </div>
        </div>
      )}

      {result && (
        <article className="actionHubResult">
          <div><strong>最近结果</strong><button onClick={() => setResult("")}>关闭</button></div>
          <pre>{result}</pre>
        </article>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function defaultPayload(action: ActionDefinition): string {
  if (action.id === "ai.generate") {
    return '{\n  "prompt": "只回复 ACTION_HUB_OK"\n}';
  }
  const properties = (action.inputSchema.properties ?? {}) as Record<string, { type?: string }>;
  const example: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(properties)) {
    example[key] = schema.type === "number" || schema.type === "integer"
      ? 1
      : schema.type === "boolean"
        ? true
        : "";
  }
  return JSON.stringify(example, null, 2);
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
