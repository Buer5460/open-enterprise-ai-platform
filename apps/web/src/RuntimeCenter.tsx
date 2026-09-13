import React from "react";
import {
  apiFetch,
  apiUrl
} from "./apiClient";
import type {
  UsabilityStatus
} from "./GettingStarted";
import "./RuntimeCenter.css";

type Provider = {
  id: string;
  name: string;
  configured: boolean;
  loginEnabled: boolean;
};

type AISettings = {
  providerMode:
    | "auto"
    | "deepseek-harness"
    | "openai-compatible";
  selectedProvider:
    | "deepseek-harness"
    | "openai-compatible";
  openAICompatible: {
    baseUrl: string;
    model: string;
    timeoutMs: number;
    hasApiKey: boolean;
    configSource:
      | "organization-vault"
      | "environment"
      | "none";
    complete: boolean;
  };
};

export function RuntimeCenter() {
  const [status, setStatus] =
    React.useState<UsabilityStatus | null>(null);
  const [settings, setSettings] =
    React.useState<AISettings | null>(null);
  const [providers, setProviders] =
    React.useState<Provider[]>([]);
  const [canManage, setCanManage] =
    React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const [providerMode, setProviderMode] =
    React.useState<AISettings["providerMode"]>("auto");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [model, setModel] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [timeoutMs, setTimeoutMs] =
    React.useState("120000");
  const [clearApiKey, setClearApiKey] =
    React.useState(false);

  const load = React.useCallback(async () => {
    setMessage("");

    const [
      usabilityResponse,
      runtimeResponse,
      settingsResponse,
      providerResponse
    ] = await Promise.all([
      apiFetch(apiUrl("/api/usability/status")),
      apiFetch(apiUrl("/api/ai-runtime/status")),
      apiFetch(apiUrl("/api/ai-runtime/settings")),
      fetch(apiUrl("/api/auth/providers"))
    ]);

    const [
      usabilityResult,
      runtimeResult,
      settingsResult,
      providerResult
    ] = await Promise.all([
      usabilityResponse.json().catch(() => ({})),
      runtimeResponse.json().catch(() => ({})),
      settingsResponse.json().catch(() => ({})),
      providerResponse.json().catch(() => ({}))
    ]);

    if (usabilityResponse.ok && usabilityResult.ok) {
      setStatus({
        ...(usabilityResult as UsabilityStatus),
        ai:
          runtimeResponse.ok && runtimeResult.ok
            ? runtimeResult.ai
            : usabilityResult.ai
      });
    }

    if (settingsResponse.ok && settingsResult.ok) {
      const next = settingsResult.settings as AISettings;
      setCanManage(true);
      setSettings(next);
      setProviderMode(next.providerMode);
      setBaseUrl(next.openAICompatible.baseUrl || "");
      setModel(next.openAICompatible.model || "");
      setTimeoutMs(
        String(next.openAICompatible.timeoutMs || 120000)
      );
      setApiKey("");
      setClearApiKey(false);
    } else if (settingsResponse.status === 403) {
      setCanManage(false);
      setSettings(null);
    }

    if (providerResponse.ok) {
      setProviders(providerResult.providers ?? []);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function testAI() {
    setTesting(true);
    setMessage("");

    try {
      const response = await apiFetch(
        apiUrl("/api/ai-runtime/test"),
        { method: "POST" }
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "AI Runtime 测试失败"
        );
      }

      setMessage(
        `${result.provider ?? "AI"} 模型调用成功 · ${result.latencyMs ?? "-"} ms · ${result.response || "OK"}`
      );
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "AI Runtime 测试失败"
      );
    } finally {
      setTesting(false);
    }
  }

  async function saveSettings() {
    if (!canManage) return;

    const timeout = Number(timeoutMs);
    if (!Number.isFinite(timeout)) {
      setMessage("AI 超时时间必须是数字。");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const response = await apiFetch(
        apiUrl("/api/ai-runtime/settings"),
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            providerMode,
            baseUrl,
            model,
            apiKey,
            timeoutMs: timeout,
            clearApiKey
          })
        }
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "AI Runtime 配置保存失败"
        );
      }

      setMessage(
        "AI Runtime 配置已保存。API Key 已进入企业加密凭证库，不会回显到浏览器。"
      );
      setApiKey("");
      setClearApiKey(false);
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "AI Runtime 配置保存失败"
      );
    } finally {
      setSaving(false);
    }
  }

  const externalProviders = providers.filter(
    (item) => item.id !== "local"
  );
  const configuredIdentity = externalProviders.filter(
    (item) => item.configured && item.loginEnabled
  ).length;
  const aiName =
    status?.ai.displayName ||
    (status?.ai.provider === "openai-compatible"
      ? "OpenAI-Compatible AI"
      : "DeepSeek Harness");

  return (
    <section className="runtimeCenter">
      <div className="runtimeCenterHeading">
        <div>
          <span>RUNTIME & DAY-1 READINESS</span>
          <h1>AI Runtime 与启动中心</h1>
          <p>
            查看和配置企业当前真正使用的 AI Provider。模板应用和业务数据不依赖 AI；自然语言创建/修改应用可以使用 DeepSeek Harness，也可以接入 DeepSeek API、OpenAI 或兼容网关。
          </p>
        </div>
        <button onClick={() => void load()}>
          刷新状态
        </button>
      </div>

      {message && (
        <div className="runtimeCenterMessage">
          {message}
        </div>
      )}

      <div className="runtimeReadinessGrid">
        <StatusCard
          title="企业应用"
          value={String(status?.installedApps ?? 0)}
          state={(status?.installedApps ?? 0) > 0 ? "pass" : "info"}
          detail={
            (status?.installedApps ?? 0) > 0
              ? "已经可以录入和管理业务数据"
              : `当前无应用，可从 ${status?.templates ?? 4} 个业务模板一键创建`
          }
        />
        <StatusCard
          title="AI Runtime"
          value={status?.ai.available ? "已配置" : "未连接"}
          state={status?.ai.available ? "pass" : "warn"}
          detail={
            status?.ai.message ??
            "正在检查企业 AI Runtime"
          }
        />
        <StatusCard
          title="企业身份 Provider"
          value={configuredIdentity > 0 ? `${configuredIdentity} 已配置` : "开发模式/待配置"}
          state={configuredIdentity > 0 ? "pass" : "info"}
          detail="Production 需要 GitHub / Google / Microsoft / OIDC 至少一种企业登录"
        />
        <StatusCard
          title="模板能力"
          value={`${status?.templates ?? 4} 个`}
          state="pass"
          detail="CRM、旅行社、支付服务商 ERP、项目协同均可脱离 AI 创建"
        />
      </div>

      <div className="runtimeCenterGrid">
        <article className="runtimeCenterPanel">
          <div className="runtimePanelHeading">
            <div>
              <h3>{aiName}</h3>
              <p>当前企业选择的 AI Runtime Provider</p>
            </div>
            <span className={status?.ai.available ? "runtimePill pass" : "runtimePill warn"}>
              {status?.ai.available
                ? status.ai.state === "configured"
                  ? "已配置"
                  : "Runtime 可达"
                : "Runtime 未连接"}
            </span>
          </div>

          <div className="runtimeFacts">
            <div>
              <span>Provider</span>
              <strong>{status?.ai.provider ?? "checking"}</strong>
            </div>
            <div>
              <span>Model</span>
              <strong>{status?.ai.model ?? "由 Provider 管理"}</strong>
            </div>
            <div>
              <span>最近检查</span>
              <strong>{formatDate(status?.ai.checkedAt)}</strong>
            </div>
          </div>

          {status?.ai.warning && (
            <div className="runtimeInlineWarning">
              {status.ai.warning}
            </div>
          )}

          <button
            className="runtimePrimary"
            disabled={testing || !canManage}
            onClick={() => void testAI()}
          >
            {!canManage
              ? "仅管理员可执行真实测试"
              : testing
                ? "正在真实调用模型…"
                : "执行真实 AI 测试"}
          </button>

          <p className="runtimeNote">
            “已配置”表示服务端已经具备 Provider 参数；真实 AI 测试才会实际请求模型，用于验证网络、API Key、模型名称和限额。
          </p>
        </article>

        <article className="runtimeCenterPanel">
          <div className="runtimePanelHeading">
            <div>
              <h3>企业 AI Provider 配置</h3>
              <p>
                {canManage
                  ? "Owner / Admin 可配置；API Key 加密保存且不会回显。"
                  : "当前账号只可查看 Runtime 状态，不能修改 Provider 配置。"}
              </p>
            </div>
          </div>

          {canManage ? (
            <div className="runtimeSettingsForm">
              <label>
                <span>Provider 模式</span>
                <select
                  value={providerMode}
                  onChange={(event) =>
                    setProviderMode(
                      event.target.value as AISettings["providerMode"]
                    )
                  }
                >
                  <option value="auto">Auto（优先完整的兼容 API，否则 Harness）</option>
                  <option value="deepseek-harness">DeepSeek Harness</option>
                  <option value="openai-compatible">OpenAI-Compatible API</option>
                </select>
              </label>

              <label>
                <span>Base URL</span>
                <input
                  value={baseUrl}
                  onChange={(event) =>
                    setBaseUrl(event.target.value)
                  }
                  placeholder="例如：https://api.deepseek.com 或 https://api.openai.com/v1"
                />
              </label>

              <label>
                <span>Model</span>
                <input
                  value={model}
                  onChange={(event) =>
                    setModel(event.target.value)
                  }
                  placeholder="例如：deepseek-chat / gpt-5.6"
                />
              </label>

              <label>
                <span>
                  API Key
                  {settings?.openAICompatible.hasApiKey
                    ? "（已保存，留空保持不变）"
                    : ""}
                </span>
                <input
                  type="password"
                  value={apiKey}
                  autoComplete="new-password"
                  onChange={(event) =>
                    setApiKey(event.target.value)
                  }
                  placeholder={
                    settings?.openAICompatible.hasApiKey
                      ? "•••••••• 已加密保存"
                      : "输入 Provider API Key"
                  }
                />
              </label>

              <label>
                <span>调用超时（毫秒）</span>
                <input
                  type="number"
                  min="5000"
                  max="300000"
                  step="1000"
                  value={timeoutMs}
                  onChange={(event) =>
                    setTimeoutMs(event.target.value)
                  }
                />
              </label>

              <label className="runtimeCheckbox">
                <input
                  type="checkbox"
                  checked={clearApiKey}
                  onChange={(event) =>
                    setClearApiKey(event.target.checked)
                  }
                />
                <span>清除当前企业已保存的 API Key</span>
              </label>

              <div className="runtimeSettingsMeta">
                <span>
                  当前来源：
                  {settings?.openAICompatible.configSource ?? "none"}
                </span>
                <span>
                  当前选择：
                  {settings?.selectedProvider ?? "-"}
                </span>
              </div>

              <button
                className="runtimePrimary"
                disabled={saving}
                onClick={() => void saveSettings()}
              >
                {saving
                  ? "保存中…"
                  : "保存企业 AI 配置"}
              </button>
            </div>
          ) : (
            <div className="runtimeConfigList">
              <ConfigRow
                name="Provider"
                detail={status?.ai.provider ?? "尚未确定"}
              />
              <ConfigRow
                name="状态"
                detail={status?.ai.message ?? "正在检查"}
              />
            </div>
          )}
        </article>
      </div>

      <div className="runtimeCenterGrid">
        <article className="runtimeCenterPanel">
          <div className="runtimePanelHeading">
            <div>
              <h3>部署级回退配置</h3>
              <p>适用于服务器统一配置；企业 Vault 中的同名字段优先。</p>
            </div>
          </div>

          <div className="runtimeConfigList">
            <ConfigRow
              name="OEAP_AI_PROVIDER"
              detail="auto / deepseek-harness / openai-compatible"
            />
            <ConfigRow
              name="OEAP_OPENAI_BASE_URL"
              detail="OpenAI-Compatible API 基础地址"
            />
            <ConfigRow
              name="OEAP_OPENAI_MODEL"
              detail="兼容 Provider 的模型名称"
            />
            <ConfigRow
              name="OEAP_OPENAI_API_KEY"
              detail="服务器级 API Key；推荐企业场景优先使用加密 Vault"
            />
            <ConfigRow
              name="OEAP_HARNESS_ROOT / OEAP_DSH_HOME"
              detail="DeepSeek Harness 本地 Runtime 路径"
            />
          </div>
        </article>

        <article className="runtimeCenterPanel runtimeNextSteps">
          <h3>从“安装完成”到“真正使用”</h3>
          <div className="runtimeSteps compact">
            <Step
              number="1"
              title="创建第一个业务应用"
              text="没有 AI 也可以使用模板；应用创建后即可录入真实数据。"
              done={(status?.installedApps ?? 0) > 0}
            />
            <Step
              number="2"
              title="连接 AI Runtime"
              text="连接后即可使用自然语言创建新应用和修改已有应用。"
              done={Boolean(status?.ai.available)}
            />
            <Step
              number="3"
              title="配置企业身份"
              text="正式多人使用前配置企业 OAuth/OIDC，并通过成员邀请分配角色。"
              done={configuredIdentity > 0}
            />
            <Step
              number="4"
              title="Production Preflight"
              text="服务器上线前检查 HTTPS、CORS、SSO、数据目录和安全响应头。"
              done={false}
            />
          </div>
        </article>
      </div>
    </section>
  );
}

function StatusCard(props: {
  title: string;
  value: string;
  state: "pass" | "warn" | "info";
  detail: string;
}) {
  return (
    <article className={`runtimeStatusCard ${props.state}`}>
      <span>{props.title}</span>
      <strong>{props.value}</strong>
      <p>{props.detail}</p>
    </article>
  );
}

function ConfigRow(props: {
  name: string;
  detail: string;
}) {
  return (
    <div className="runtimeConfigRow">
      <code>{props.name}</code>
      <span>{props.detail}</span>
    </div>
  );
}

function Step(props: {
  number: string;
  title: string;
  text: string;
  done: boolean;
}) {
  return (
    <div className="runtimeStep">
      <div className={props.done ? "stepNumber done" : "stepNumber"}>
        {props.done ? "✓" : props.number}
      </div>
      <div>
        <strong>{props.title}</strong>
        <p>{props.text}</p>
      </div>
    </div>
  );
}

function formatDate(value?: string): string {
  if (!value) return "尚未检查";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN");
}
