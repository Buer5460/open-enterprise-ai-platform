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

export function RuntimeCenter() {
  const [status, setStatus] =
    React.useState<UsabilityStatus | null>(null);
  const [providers, setProviders] =
    React.useState<Provider[]>([]);
  const [testing, setTesting] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const load = React.useCallback(async () => {
    setMessage("");

    const [statusResponse, providerResponse] =
      await Promise.all([
        apiFetch(apiUrl("/api/usability/status")),
        fetch(apiUrl("/api/auth/providers"))
      ]);

    const [statusResult, providerResult] =
      await Promise.all([
        statusResponse.json().catch(() => ({})),
        providerResponse.json().catch(() => ({}))
      ]);

    if (statusResponse.ok && statusResult.ok) {
      setStatus(statusResult as UsabilityStatus);
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
        apiUrl("/api/usability/ai/test"),
        { method: "POST" }
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "AI Runtime 测试失败"
        );
      }

      setMessage(
        `AI 模型调用成功 · ${result.latencyMs ?? "-"} ms · ${result.response || "OK"}`
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

  const externalProviders = providers.filter(
    (item) => item.id !== "local"
  );
  const configuredIdentity = externalProviders.filter(
    (item) => item.configured && item.loginEnabled
  ).length;

  return (
    <section className="runtimeCenter">
      <div className="runtimeCenterHeading">
        <div>
          <span>RUNTIME & DAY-1 READINESS</span>
          <h1>AI Runtime 与启动中心</h1>
          <p>
            查看平台当前真正可用的能力。模板应用和企业数据不依赖 AI Runtime；自然语言创建/修改应用需要 DeepSeek Harness 或后续兼容 Provider。
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
          value={status?.ai.available ? "已连接" : "未连接"}
          state={status?.ai.available ? "pass" : "warn"}
          detail={
            status?.ai.message ??
            "正在检查 DeepSeek Harness"
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
              <h3>DeepSeek Harness</h3>
              <p>当前默认 AI Runtime Adapter</p>
            </div>
            <span className={status?.ai.available ? "runtimePill pass" : "runtimePill warn"}>
              {status?.ai.available ? "Runtime 可达" : "Runtime 未连接"}
            </span>
          </div>

          <div className="runtimeFacts">
            <div>
              <span>Provider</span>
              <strong>deepseek-harness</strong>
            </div>
            <div>
              <span>运行状态</span>
              <strong>{status?.ai.state ?? "checking"}</strong>
            </div>
            <div>
              <span>最近检查</span>
              <strong>{formatDate(status?.ai.checkedAt)}</strong>
            </div>
          </div>

          <button
            className="runtimePrimary"
            disabled={testing}
            onClick={() => void testAI()}
          >
            {testing
              ? "正在真实调用模型…"
              : "执行真实 AI 测试"}
          </button>

          <p className="runtimeNote">
            Runtime 健康检查只确认 Harness CLI 可用；“真实 AI 测试”会发起一个最小模型调用，用于验证 Provider、凭证和模型链路。
          </p>
        </article>

        <article className="runtimeCenterPanel">
          <div className="runtimePanelHeading">
            <div>
              <h3>服务器配置</h3>
              <p>不在浏览器保存任何 AI 密钥</p>
            </div>
          </div>

          <div className="runtimeConfigList">
            <ConfigRow
              name="OEAP_HARNESS_ROOT"
              detail="DeepSeek Harness 安装目录；未设置时使用 OEAP 同级 deepseek-harness"
            />
            <ConfigRow
              name="OEAP_DSH_HOME"
              detail="Harness 独立运行目录；未设置时使用 OEAP 同级 .dsh-dev"
            />
            <ConfigRow
              name="OEAP_AI_TIMEOUT_MS"
              detail="单次 AI 调用超时；默认 120 秒，平台会强制上下限"
            />
          </div>

          <p className="runtimeNote">
            模型/API 凭证仍由 Harness 或部署环境管理。OEAP 只读取运行结果，不把第三方模型密钥返回给前端。
          </p>
        </article>
      </div>

      <article className="runtimeCenterPanel runtimeNextSteps">
        <h3>从“安装完成”到“真正使用”</h3>
        <div className="runtimeSteps">
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
            title="上线前运行 Production Preflight"
            text="服务器部署完成后检查 HTTPS、CORS、SSO、数据目录和安全响应头。"
            done={false}
          />
        </div>
      </article>
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
