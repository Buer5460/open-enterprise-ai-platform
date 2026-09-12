import React from "react";
import {
  apiFetch,
  getAuthToken,
  setAuthToken
} from "./apiClient";
import {
  BrandMark,
  useBrand
} from "./BrandRuntime";
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

type InvitationRole = {
  id: string;
  name: string;
  permissions: string[];
};

type InvitationApp = {
  id: string;
  displayName?: string;
  name: string;
};

type Invitation = {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  invitedName?: string;
  roleId: string;
  roleName: string;
  appIds: string[];
  status:
    | "pending"
    | "accepted"
    | "revoked"
    | "expired";
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
};

export function AuthPanel() {
  const { brand } = useBrand();
  const [providers, setProviders] =
    React.useState<Provider[]>([]);
  const [session, setSession] =
    React.useState<SessionResponse | null>(null);
  const [loading, setLoading] =
    React.useState(true);
  const [message, setMessage] =
    React.useState("");

  const [inviteRoles, setInviteRoles] =
    React.useState<InvitationRole[]>([]);
  const [inviteApps, setInviteApps] =
    React.useState<InvitationApp[]>([]);
  const [invitations, setInvitations] =
    React.useState<Invitation[]>([]);
  const [canManageInvites, setCanManageInvites] =
    React.useState(false);
  const [inviteEmail, setInviteEmail] =
    React.useState("");
  const [inviteName, setInviteName] =
    React.useState("");
  const [inviteRoleId, setInviteRoleId] =
    React.useState("");
  const [inviteAllApps, setInviteAllApps] =
    React.useState(true);
  const [inviteAppIds, setInviteAppIds] =
    React.useState<string[]>([]);
  const [inviteHours, setInviteHours] =
    React.useState("72");
  const [inviteUrl, setInviteUrl] =
    React.useState("");
  const [inviteWorking, setInviteWorking] =
    React.useState(false);

  const loadInvitations = React.useCallback(
    async () => {
      try {
        const [optionsResponse, listResponse] =
          await Promise.all([
            apiFetch(`${API}/api/invitations/options`),
            apiFetch(`${API}/api/invitations`)
          ]);

        if (
          optionsResponse.status === 403 ||
          listResponse.status === 403
        ) {
          setCanManageInvites(false);
          return;
        }

        const options = await optionsResponse.json();
        const list = await listResponse.json();

        if (!optionsResponse.ok || !options.ok) {
          throw new Error(
            options.error ?? "邀请配置加载失败"
          );
        }

        if (!listResponse.ok || !list.ok) {
          throw new Error(
            list.error ?? "邀请列表加载失败"
          );
        }

        const roles: InvitationRole[] =
          options.roles ?? [];

        setCanManageInvites(true);
        setInviteRoles(roles);
        setInviteApps(options.apps ?? []);
        setInvitations(list.invitations ?? []);

        setInviteRoleId((current) => {
          if (current) return current;
          return (
            roles.find(
              (role) => role.name === "Member"
            )?.id ??
            roles[0]?.id ??
            ""
          );
        });
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "邀请信息加载失败"
        );
      }
    },
    []
  );

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

      if (current?.authenticated) {
        await loadInvitations();
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "登录状态加载失败"
      );
    } finally {
      setLoading(false);
    }
  }, [loadInvitations]);

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
      setCanManageInvites(false);
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

  function toggleInviteApp(
    appId: string,
    enabled: boolean
  ) {
    setInviteAppIds((current) =>
      enabled
        ? [...new Set([...current, appId])]
        : current.filter((id) => id !== appId)
    );
  }

  async function createInvitation() {
    if (!inviteEmail.trim() || !inviteRoleId) {
      setMessage("请填写邀请邮箱并选择角色。");
      return;
    }

    setInviteWorking(true);
    setInviteUrl("");
    setMessage("");

    try {
      const response = await apiFetch(
        `${API}/api/invitations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: inviteEmail,
            invitedName: inviteName,
            roleId: inviteRoleId,
            appIds:
              inviteAllApps
                ? ["*"]
                : inviteAppIds,
            expiresHours:
              Number(inviteHours) || 72
          })
        }
      );

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "创建邀请失败"
        );
      }

      setInviteUrl(result.inviteUrl ?? "");
      setInviteEmail("");
      setInviteName("");
      setMessage(
        "邀请已创建。请复制下方链接发送给成员；出于安全原因，原始邀请链接不会再次显示。"
      );
      await loadInvitations();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "创建邀请失败"
      );
    } finally {
      setInviteWorking(false);
    }
  }

  async function copyInviteUrl() {
    if (!inviteUrl) return;

    try {
      await navigator.clipboard.writeText(
        inviteUrl
      );
      setMessage("邀请链接已复制。");
    } catch {
      setMessage(
        "浏览器未允许自动复制，请手动选择链接复制。"
      );
    }
  }

  async function revokeInvitation(
    invitationId: string
  ) {
    const response = await apiFetch(
      `${API}/api/invitations/${encodeURIComponent(
        invitationId
      )}/revoke`,
      { method: "POST" }
    );

    const result = await response.json();

    if (!response.ok || !result.ok) {
      setMessage(
        result.error ?? "撤销邀请失败"
      );
      return;
    }

    setMessage("邀请已撤销。");
    await loadInvitations();
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

      <div className="authBrandCard">
        <BrandMark className="authBrandLogo" />
        <div>
          <strong>
            {brand.loginTitle || brand.shortName || brand.organizationName}
          </strong>
          <span>{brand.loginSubtitle}</span>
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
              {brand.organizationName ||
                session.organization?.name ||
                session.session?.organizationId ||
                "Organization"}
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

      {canManageInvites && (
        <section className="inviteManager">
          <div className="inviteHeading">
            <div>
              <span>MEMBER INVITATION</span>
              <h4>邀请成员加入企业</h4>
              <p>
                生成一次性邀请链接，预先绑定邮箱、角色和应用访问范围。成员接受后自动加入组织并建立登录会话。
              </p>
            </div>
            <strong>
              {invitations.filter(
                (item) => item.status === "pending"
              ).length} 个待接受
            </strong>
          </div>

          <div className="inviteLayout">
            <div className="inviteForm">
              <label>
                <span>成员姓名（可选）</span>
                <input
                  value={inviteName}
                  onChange={(event) =>
                    setInviteName(event.target.value)
                  }
                  placeholder="例如：张经理"
                />
              </label>

              <label>
                <span>邀请邮箱</span>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) =>
                    setInviteEmail(event.target.value)
                  }
                  placeholder="name@company.com"
                />
              </label>

              <div className="inviteFormRow">
                <label>
                  <span>角色</span>
                  <select
                    value={inviteRoleId}
                    onChange={(event) =>
                      setInviteRoleId(
                        event.target.value
                      )
                    }
                  >
                    {inviteRoles.map((role) => (
                      <option
                        key={role.id}
                        value={role.id}
                      >
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>有效期</span>
                  <select
                    value={inviteHours}
                    onChange={(event) =>
                      setInviteHours(
                        event.target.value
                      )
                    }
                  >
                    <option value="24">24 小时</option>
                    <option value="72">3 天</option>
                    <option value="168">7 天</option>
                    <option value="720">30 天</option>
                  </select>
                </label>
              </div>

              <div className="inviteApps">
                <span>应用访问范围</span>
                <label>
                  <input
                    type="checkbox"
                    checked={inviteAllApps}
                    onChange={(event) => {
                      setInviteAllApps(
                        event.target.checked
                      );
                      if (event.target.checked) {
                        setInviteAppIds([]);
                      }
                    }}
                  />
                  全部企业应用
                </label>

                {!inviteAllApps && (
                  <div className="inviteAppGrid">
                    {inviteApps.map((app) => (
                      <label key={app.id}>
                        <input
                          type="checkbox"
                          checked={
                            inviteAppIds.includes(
                              app.id
                            )
                          }
                          onChange={(event) =>
                            toggleInviteApp(
                              app.id,
                              event.target.checked
                            )
                          }
                        />
                        {app.displayName ?? app.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <button
                className="inviteCreateButton"
                disabled={inviteWorking}
                onClick={() =>
                  void createInvitation()
                }
              >
                {inviteWorking
                  ? "正在生成…"
                  : "生成邀请链接"}
              </button>

              {inviteUrl && (
                <div className="inviteUrlBox">
                  <input
                    readOnly
                    value={inviteUrl}
                    onFocus={(event) =>
                      event.currentTarget.select()
                    }
                  />
                  <button
                    onClick={() =>
                      void copyInviteUrl()
                    }
                  >
                    复制链接
                  </button>
                </div>
              )}
            </div>

            <div className="inviteList">
              <div className="inviteListHeader">
                <strong>邀请记录</strong>
                <span>
                  原始邀请 Token 不落库，仅创建时显示一次
                </span>
              </div>

              {invitations.length === 0 ? (
                <div className="inviteEmpty">
                  暂无邀请记录
                </div>
              ) : (
                invitations.slice(0, 8).map(
                  (invitation) => (
                    <div
                      className="inviteItem"
                      key={invitation.id}
                    >
                      <div>
                        <strong>
                          {invitation.invitedName ||
                            invitation.email}
                        </strong>
                        <span>{invitation.email}</span>
                        <small>
                          {invitation.roleName} · {
                            invitation.appIds.includes("*")
                              ? "全部应用"
                              : `${invitation.appIds.length} 个应用`
                          }
                        </small>
                      </div>

                      <div className="inviteItemState">
                        <em
                          className={`inviteStatus inviteStatus-${invitation.status}`}
                        >
                          {inviteStatusLabel(
                            invitation.status
                          )}
                        </em>
                        <small>
                          至 {formatTime(
                            invitation.expiresAt
                          )}
                        </small>
                        {invitation.status ===
                          "pending" && (
                          <button
                            onClick={() =>
                              void revokeInvitation(
                                invitation.id
                              )
                            }
                          >
                            撤销
                          </button>
                        )}
                      </div>
                    </div>
                  )
                )
              )}
            </div>
          </div>
        </section>
      )}

      {message && (
        <div className="authMessage">
          {message}
        </div>
      )}
    </article>
  );
}

function inviteStatusLabel(
  status: Invitation["status"]
): string {
  if (status === "pending") return "待接受";
  if (status === "accepted") return "已加入";
  if (status === "revoked") return "已撤销";
  return "已过期";
}

function formatTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
