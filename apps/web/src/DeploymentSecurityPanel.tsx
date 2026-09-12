import React from "react";
import { apiFetch } from "./apiClient";
import "./DeploymentSecurityPanel.css";

const API = "http://127.0.0.1:8787";

type CheckStatus =
  | "pass"
  | "warning"
  | "fail"
  | "info";

type DeploymentCheck = {
  id: string;
  title: string;
  status: CheckStatus;
  summary: string;
  action?: string;
};

type DeploymentStatus = {
  ok: boolean;
  mode: "development" | "production";
  production: boolean;
  score: number;
  counts: {
    pass: number;
    warning: number;
    fail: number;
    info: number;
  };
  checks: DeploymentCheck[];
  authProviders: Array<{
    id: string;
    name: string;
    configured: boolean;
  }>;
  mailProvider: string;
  generatedAt: string;
};

export function DeploymentSecurityPanel() {
  const [status, setStatus] =
    React.useState<DeploymentStatus | null>(null);
  const [loading, setLoading] =
    React.useState(true);
  const [message, setMessage] =
    React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const response = await apiFetch(
        `${API}/api/deployment/status`
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "部署状态加载失败"
        );
      }

      setStatus(result);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "部署状态加载失败"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="deploymentPanel">
      <div className="deploymentHeader">
        <div>
          <span>DEPLOYMENT & SECURITY</span>
          <h3>部署与安全中心</h3>
          <p>
            检查当前实例从本地开发走向企业生产部署所需的身份、公开地址、CORS、邮件、品牌和持久化配置。
          </p>
        </div>

        <div className="deploymentSummary">
          <strong>
            {status ? `${status.score}%` : "--"}
          </strong>
          <small>生产就绪度</small>
          <em
            className={
              status?.production
                ? "production"
                : "development"
            }
          >
            {status?.production
              ? "Production"
              : "Development"}
          </em>
        </div>
      </div>

      {loading && (
        <div className="deploymentEmpty">
          正在检查部署与安全状态…
        </div>
      )}

      {!loading && message && (
        <div className="deploymentEmpty error">
          {message}
        </div>
      )}

      {status && (
        <>
          <div className="deploymentStats">
            <div>
              <strong>{status.counts.pass}</strong>
              <span>已就绪</span>
            </div>
            <div>
              <strong>{status.counts.warning}</strong>
              <span>建议完善</span>
            </div>
            <div>
              <strong>{status.counts.fail}</strong>
              <span>上线阻塞</span>
            </div>
            <div>
              <strong>{status.mailProvider}</strong>
              <span>邮件通道</span>
            </div>
          </div>

          <div className="deploymentChecks">
            {status.checks.map((check) => (
              <article
                key={check.id}
                className={`deploymentCheck ${check.status}`}
              >
                <div className="deploymentCheckTop">
                  <strong>{check.title}</strong>
                  <em>{statusLabel(check.status)}</em>
                </div>
                <p>{check.summary}</p>
                {check.action && (
                  <small>{check.action}</small>
                )}
              </article>
            ))}
          </div>

          <div className="deploymentProviders">
            <span>企业身份 Provider</span>
            {status.authProviders.map((provider) => (
              <em
                key={provider.id}
                className={
                  provider.configured
                    ? "configured"
                    : ""
                }
              >
                {provider.name} · {
                  provider.configured
                    ? "已配置"
                    : "待配置"
                }
              </em>
            ))}

            <button
              onClick={() => void load()}
              disabled={loading}
            >
              重新检查
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function statusLabel(
  status: CheckStatus
): string {
  if (status === "pass") return "通过";
  if (status === "warning") return "建议";
  if (status === "fail") return "阻塞";
  return "开发信息";
}
