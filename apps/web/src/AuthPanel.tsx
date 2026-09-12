import React from "react";
import {
  apiFetch,
  getAuthToken,
  setAuthToken
} from "./apiClient";
import "./AuthPanel.css";

const API = "http://127.0.0.1:8787";

type Provider = {
  id: "local" | "github" | "google" | "microsoft" | "oidc";
  name: string;
  type: "local" | "oauth2" | "oidc";
  configured: boolean;
  loginEnabled: boolean;
  description: string;
};

type SessionResponse = {
  ok: boolean;
  authenticated: boolean;
  session?: {
    provider: string;
    organizationId: string;
    memberId: string;
    email?: string;
    name?: string;
    expiresAt: string;
  };
  organization?: {
    id: string;
    name: string;
  };
  member?: {
    id: string;
    name: string;
    email: string;
    roleName: string;
  };
};

export function AuthPanel() {
  const [providers, setProviders] =
    React.useState<Provider[]>([]);
  const [session, setSession] =
    React.useState<SessionResponse | null>(null);
  const [loading, setLoading] =
    React.useState(true);
  const [message, setMessage] =
    React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const providerResponse = await fetch(
        `${API}/api/auth/providers`
      );
      const providerResult =
        await providerResponse.json();

      setProviders(
        providerResult.providers ?? []
      );

      let current: SessionResponse | null = null;

      if (getAuthToken()) {
        const sessionResponse = await apiFetch(
          `${API}/api/auth/session`
        );

        if (sessionResponse.ok) {
          current = await sessionResponse.json();
        } else {
          setAuthToken(undefined);
        }
      }

      if (!current && providerResult.localDevelopmentMode) {
        const localResponse = await fetch(
          `${API}/api/auth/local`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              organizationId: "org_local",
              memberId: "member_local_owner"
            })
          }
        );

        const localResult =
          await localResponse.json();

        if (localResponse.ok && localResult.ok) {
          setAuthToken(localResult.token);
          current = {
            ok: true,
            authenticated: true,
            session: localResult.session,
            organization: localResult.organization,
            member: localResult.member
          };
        }
      }

      setSession(current);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "登录状态加载失败"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    try {
      await apiFetch(
        `${API}/api/auth/logout`,
        { method: "POST" }
      );
    } finally {
      setAuthToken(undefined);
      setSession(null);
      setMessage(
        "当前会话已注销。刷新页面后，本地开发模式会重新建立 Owner 会话。"
      );
    }
  }

  async function inspectProvider(
    provider: Provider
  ) {
    if (provider.id === "local") {
      setMessage(
        "本地开发身份已启用，用于自托管启动和开发环境。"
      );
      return;
    }

    const response = await fetch(
      `${API}/api/auth/${provider.id}/start`
    );
    const result = await response.json();

    setMessage(
      response.ok
        ? `${provider.name} 已配置，可进入 OAuth / SSO 回调阶段。`
        : result.error ?? `${provider.name} 尚未配置。`
    );
  }

  return (
    <article className="authPanel">
      <div className="authPanelHeader">
        <div>
          <span>IDENTITY & SSO</span>
          <h3>企业登录与身份</h3>
          <p>
            Session 已独立于业务权限。OAuth / OIDC Provider 可按企业部署环境配置，不需要把凭证写进代码。
          </p>
        </div>

        <div className="authState">
          {loading ? (
            <strong>检查中…</strong>
          ) : session?.authenticated ? (
            <>
              <strong>已登录</strong>
              <small>
                {session.member?.name ??
                  session.session?.name ??
                  "Member"}
              </small>
            </>
          ) : (
            <strong>未登录</strong>
          )}
        </div>
      </div>

      {session?.authenticated && (
        <div className="authSessionCard">
          <div>
            <strong>
              {session.member?.name ??
                session.session?.name}
            </strong>
            <span>
              {session.member?.email ??
                session.session?.email}
            </span>
          </div>
          <div>
            <small>组织</small>
            <strong>
              {session.organization?.name ??
                session.session?.organizationId}
            </strong>
          </div>
          <div>
            <small>角色</small>
            <strong>
              {session.member?.roleName ?? "Member"}
            </strong>
          </div>
          <div>
            <small>Provider</small>
            <strong>
              {session.session?.provider ?? "local"}
            </strong>
          </div>
          <button onClick={() => void logout()}>
            注销会话
          </button>
        </div>
      )}

      <div className="authProviders">
        {providers.map((provider) => (
          <button
            key={provider.id}
            className={
              provider.configured
                ? "configured"
                : ""
            }
            onClick={() =>
              void inspectProvider(provider)
            }
          >
            <div>
              <strong>{provider.name}</strong>
              <span>{provider.description}</span>
            </div>
            <em>
              {provider.id === "local"
                ? "本地"
                : provider.configured
                  ? "已配置"
                  : "待配置"}
            </em>
          </button>
        ))}
      </div>

      {message && (
        <div className="authMessage">
          {message}
        </div>
      )}
    </article>
  );
}
