import React from "react";
import type { BrandSettings } from "./BrandRuntime";
import {
  apiFetch,
  apiUrl,
  getAuthToken,
  setAuthToken
} from "./apiClient";
import "./ProductionLogin.css";

type Provider = {
  id: "local" | "github" | "google" | "microsoft" | "oidc";
  name: string;
  type: "local" | "oauth2" | "oidc";
  configured: boolean;
  loginEnabled: boolean;
  description: string;
};

type ProviderResponse = {
  ok: boolean;
  deploymentMode?: "development" | "production";
  localDevelopmentMode?: boolean;
  providers?: Provider[];
};

export type AuthGateState =
  | "checking"
  | "ready"
  | "login";

export async function resolveAuthGate(): Promise<{
  state: AuthGateState;
  providers: Provider[];
  production: boolean;
}> {
  const providerResponse = await fetch(
    apiUrl("/api/auth/providers")
  );
  const providerResult =
    await providerResponse.json() as ProviderResponse;

  const providers =
    providerResult.providers ?? [];
  const production =
    providerResult.deploymentMode === "production";

  if (!production) {
    return {
      state: "ready",
      providers,
      production: false
    };
  }

  if (getAuthToken()) {
    const sessionResponse = await apiFetch(
      apiUrl("/api/auth/session")
    );

    if (sessionResponse.ok) {
      const session = await sessionResponse.json();
      if (session?.authenticated) {
        return {
          state: "ready",
          providers,
          production: true
        };
      }
    }

    setAuthToken(undefined);
  }

  return {
    state: "login",
    providers,
    production: true
  };
}

export function ProductionLogin(props: {
  brand: BrandSettings;
  providers: Provider[];
  onRetry: () => void;
}) {
  const [working, setWorking] =
    React.useState<string | null>(null);
  const [message, setMessage] =
    React.useState("");

  const configured = props.providers.filter(
    (provider) =>
      provider.id !== "local" &&
      provider.configured &&
      provider.loginEnabled
  );

  async function login(provider: Provider) {
    setWorking(provider.id);
    setMessage("");

    try {
      const response = await fetch(
        apiUrl(
          `/api/auth/${encodeURIComponent(provider.id)}/start`
        )
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? `${provider.name} 登录不可用`
        );
      }

      if (!result.authorizationUrl) {
        throw new Error("登录服务没有返回授权地址");
      }

      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "无法启动企业登录"
      );
      setWorking(null);
    }
  }

  return (
    <main className="productionLogin">
      <section className="productionLoginCard">
        <div className="productionLoginBrand">
          <div className="productionLoginLogo">
            {props.brand.logoUrl ? (
              <img
                src={props.brand.logoUrl}
                alt={
                  props.brand.shortName ||
                  props.brand.organizationName
                }
              />
            ) : (
              <strong>
                {(
                  props.brand.shortName ||
                  props.brand.organizationName ||
                  "O"
                ).slice(0, 1).toUpperCase()}
              </strong>
            )}
          </div>
          <div>
            <span>ENTERPRISE AI WORKSPACE</span>
            <h1>
              {props.brand.loginTitle ||
                props.brand.organizationName}
            </h1>
            <p>
              {props.brand.loginSubtitle ||
                "安全登录后进入企业 AI 工作台"}
            </p>
          </div>
        </div>

        <div className="productionLoginDivider" />

        <div className="productionLoginHeading">
          <h2>登录企业工作区</h2>
          <p>
            使用企业管理员已经配置的身份 Provider。只有已加入当前企业组织的邮箱才能获得访问权限。
          </p>
        </div>

        {configured.length > 0 ? (
          <div className="productionLoginProviders">
            {configured.map((provider) => (
              <button
                key={provider.id}
                disabled={Boolean(working)}
                onClick={() => void login(provider)}
              >
                <span className="providerMark">
                  {providerInitial(provider.id)}
                </span>
                <span>
                  <strong>
                    {working === provider.id
                      ? "正在跳转…"
                      : `使用 ${provider.name} 登录`}
                  </strong>
                  <small>{provider.description}</small>
                </span>
                <em>→</em>
              </button>
            ))}
          </div>
        ) : (
          <div className="productionLoginEmpty">
            <strong>尚未配置企业登录 Provider</strong>
            <p>
              管理员需要配置 GitHub、Google Workspace、Microsoft Entra ID 或企业 OIDC 中至少一种登录方式。
            </p>
          </div>
        )}

        {message && (
          <div className="productionLoginMessage">
            {message}
          </div>
        )}

        <button
          className="productionLoginRetry"
          onClick={props.onRetry}
        >
          已完成登录？重新检查会话
        </button>

        <footer>
          <span>
            {props.brand.organizationName ||
              "OpenEnterpriseAI"}
          </span>
          <span>OEAP Secure Session</span>
        </footer>
      </section>
    </main>
  );
}

function providerInitial(
  provider: Provider["id"]
): string {
  if (provider === "github") return "GH";
  if (provider === "google") return "G";
  if (provider === "microsoft") return "M";
  if (provider === "oidc") return "ID";
  return "O";
}
