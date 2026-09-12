import React from "react";
import { AuthPanel } from "./AuthPanel";
import { MailSettingsPanel } from "./MailSettingsPanel";
import { apiFetch } from "./apiClient";
import "./OrganizationCenter.css";

const API = "http://127.0.0.1:8787";

type Role = {
  id: string;
  organizationId: string;
  name: string;
  permissions: string[];
  system: boolean;
};

type Member = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  status: "active" | "disabled";
  roleId: string;
  roleName: string;
  appIds: string[];
};

type ContextResponse = {
  ok: boolean;
  context: {
    organization: {
      id: string;
      name: string;
      slug: string;
    };
    roles: Role[];
    members: Member[];
  };
  currentMemberId: string;
  audit: Array<{
    id: number;
    actorMemberId?: string;
    action: string;
    subjectType: string;
    subjectId?: string;
    createdAt: string;
  }>;
};

type AppItem = {
  id: string;
  displayName?: string;
  name: string;
};

export function OrganizationCenter() {
  const [data, setData] =
    React.useState<ContextResponse | null>(null);
  const [apps, setApps] =
    React.useState<AppItem[]>([]);
  const [loading, setLoading] =
    React.useState(true);
  const [message, setMessage] =
    React.useState("");

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [roleId, setRoleId] = React.useState("");
  const [creatingMember, setCreatingMember] =
    React.useState(false);

  const [customRoleName, setCustomRoleName] =
    React.useState("");
  const [customPermissions, setCustomPermissions] =
    React.useState("apps.read,data.read");

  const orgId =
    data?.context.organization.id ?? "org_local";
  const actorId =
    data?.currentMemberId ?? "member_local_owner";

  const headers = React.useMemo(() => ({
    "Content-Type": "application/json",
    "x-oeap-org": orgId,
    "x-oeap-member": actorId
  }), [orgId, actorId]);

  const load = React.useCallback(async () => {
    const [contextResponse, appsResponse] =
      await Promise.all([
        apiFetch(`${API}/api/tenancy/context`, {
          headers: {
            "x-oeap-org": "org_local",
            "x-oeap-member": "member_local_owner"
          }
        }),
        apiFetch(`${API}/api/apps`)
      ]);

    const contextResult =
      await contextResponse.json();
    const appsResult =
      await appsResponse.json();

    if (!contextResponse.ok || !contextResult.ok) {
      throw new Error(
        contextResult.error ?? "组织信息加载失败"
      );
    }

    setData(contextResult);
    setApps(appsResult.apps ?? []);

    const defaultRole =
      contextResult.context.roles.find(
        (role: Role) => role.name === "Member"
      ) ?? contextResult.context.roles[0];

    if (defaultRole) {
      setRoleId((current) =>
        current || defaultRole.id
      );
    }
  }, []);

  React.useEffect(() => {
    load()
      .catch((error) => {
        setMessage(
          error instanceof Error
            ? error.message
            : "组织信息加载失败"
        );
      })
      .finally(() => setLoading(false));
  }, [load]);

  async function reloadCurrent() {
    const response = await apiFetch(
      `${API}/api/tenancy/context`,
      { headers }
    );
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(
        result.error ?? "刷新失败"
      );
    }

    setData(result);
  }

  async function createMember() {
    if (!name.trim() || !email.trim() || !roleId) {
      setMessage("请填写姓名、邮箱并选择角色。");
      return;
    }

    setCreatingMember(true);
    setMessage("");

    try {
      const response = await apiFetch(
        `${API}/api/tenancy/members`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            name,
            email,
            roleId,
            appIds: ["*"]
          })
        }
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "新增成员失败"
        );
      }

      setName("");
      setEmail("");
      setMessage("成员已加入当前企业组织。");
      await reloadCurrent();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "新增成员失败"
      );
    } finally {
      setCreatingMember(false);
    }
  }

  async function updateMember(
    member: Member,
    patch: Record<string, unknown>
  ) {
    const response = await apiFetch(
      `${API}/api/tenancy/members/${encodeURIComponent(member.id)}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify(patch)
      }
    );
    const result = await response.json();

    if (!response.ok || !result.ok) {
      setMessage(result.error ?? "成员更新失败");
      return;
    }

    setMessage("成员权限已更新。");
    await reloadCurrent();
  }

  async function updateAppAccess(
    member: Member,
    appId: string,
    enabled: boolean
  ) {
    let next: string[];

    if (appId === "*") {
      next = enabled ? ["*"] : [];
    } else {
      const current = member.appIds.includes("*")
        ? apps.map((item) => item.id)
        : member.appIds;

      next = enabled
        ? [...new Set([...current, appId])]
        : current.filter((id) => id !== appId);
    }

    const response = await apiFetch(
      `${API}/api/tenancy/members/${encodeURIComponent(member.id)}/apps`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ appIds: next })
      }
    );
    const result = await response.json();

    if (!response.ok || !result.ok) {
      setMessage(result.error ?? "应用授权失败");
      return;
    }

    setMessage("应用访问范围已更新。");
    await reloadCurrent();
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`移除成员 ${member.name}？`)) {
      return;
    }

    const response = await apiFetch(
      `${API}/api/tenancy/members/${encodeURIComponent(member.id)}`,
      {
        method: "DELETE",
        headers
      }
    );
    const result = await response.json();

    if (!response.ok || !result.ok) {
      setMessage(result.error ?? "移除成员失败");
      return;
    }

    setMessage("成员已移除。");
    await reloadCurrent();
  }

  async function createRole() {
    const roleName = customRoleName.trim();
    const permissions = customPermissions
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (!roleName) {
      setMessage("请填写自定义角色名称。");
      return;
    }

    const response = await apiFetch(
      `${API}/api/tenancy/roles`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: roleName,
          permissions
        })
      }
    );
    const result = await response.json();

    if (!response.ok || !result.ok) {
      setMessage(result.error ?? "角色创建失败");
      return;
    }

    setCustomRoleName("");
    setCustomPermissions("apps.read,data.read");
    setMessage("自定义角色已创建。");
    await reloadCurrent();
  }

  if (loading) {
    return (
      <div className="orgEmpty">
        正在加载企业组织与权限…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="orgEmpty">
        {message || "组织信息不可用"}
      </div>
    );
  }

  const { organization, roles, members } =
    data.context;

  return (
    <section className="organizationCenter">
      <div className="orgHeading">
        <div>
          <span>ENTERPRISE TENANCY & RBAC</span>
          <h1>企业与权限</h1>
          <p>
            管理组织、员工角色、应用访问范围、登录身份与权限审计。Session 与 OAuth / SSO Provider 已从业务权限层独立出来。
          </p>
        </div>

        <div className="orgIdentity">
          <strong>{organization.name}</strong>
          <small>{organization.id}</small>
          <em>企业身份模式</em>
        </div>
      </div>

      <AuthPanel />
      <MailSettingsPanel />

      {message && (
        <div className="orgMessage">
          {message}
        </div>
      )}

      <div className="orgStats">
        <div>
          <strong>{members.length}</strong>
          <span>组织成员</span>
        </div>
        <div>
          <strong>{roles.length}</strong>
          <span>角色</span>
        </div>
        <div>
          <strong>{apps.length}</strong>
          <span>企业应用</span>
        </div>
        <div>
          <strong>{data.audit.length}</strong>
          <span>最近审计事件</span>
        </div>
      </div>

      <div className="orgGrid">
        <article className="orgPanel memberPanel">
          <div className="orgPanelHeading">
            <div>
              <h3>成员与应用权限</h3>
              <p>角色控制能力权限，应用范围控制成员能访问哪些企业应用。</p>
            </div>
          </div>

          <div className="memberTable">
            {members.map((member) => (
              <div
                className="memberRow"
                key={member.id}
              >
                <div className="memberProfile">
                  <strong>{member.name}</strong>
                  <span>{member.email}</span>
                  <small>{member.id}</small>
                </div>

                <select
                  value={member.roleId}
                  disabled={
                    member.id === actorId &&
                    member.roleName === "Owner"
                  }
                  onChange={(event) =>
                    void updateMember(member, {
                      roleId: event.target.value
                    })
                  }
                >
                  {roles.map((role) => (
                    <option
                      key={role.id}
                      value={role.id}
                    >
                      {role.name}
                    </option>
                  ))}
                </select>

                <button
                  className={
                    member.status === "active"
                      ? "memberState active"
                      : "memberState"
                  }
                  disabled={member.id === actorId}
                  onClick={() =>
                    void updateMember(member, {
                      status:
                        member.status === "active"
                          ? "disabled"
                          : "active"
                    })
                  }
                >
                  {member.status === "active"
                    ? "已启用"
                    : "已停用"}
                </button>

                <details className="appAccess">
                  <summary>
                    {member.appIds.includes("*")
                      ? "全部应用"
                      : `${member.appIds.length} 个应用`}
                  </summary>
                  <label>
                    <input
                      type="checkbox"
                      checked={member.appIds.includes("*")}
                      onChange={(event) =>
                        void updateAppAccess(
                          member,
                          "*",
                          event.target.checked
                        )
                      }
                    />
                    全部应用
                  </label>
                  {apps.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={
                          member.appIds.includes("*") ||
                          member.appIds.includes(item.id)
                        }
                        disabled={member.appIds.includes("*")}
                        onChange={(event) =>
                          void updateAppAccess(
                            member,
                            item.id,
                            event.target.checked
                          )
                        }
                      />
                      {item.displayName ?? item.name}
                    </label>
                  ))}
                </details>

                <button
                  className="removeMember"
                  disabled={member.id === actorId}
                  onClick={() =>
                    void removeMember(member)
                  }
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        </article>

        <article className="orgPanel addMemberPanel">
          <h3>添加成员</h3>
          <p>本地模式直接创建成员；启用外部登录后可升级为邀请与域账号绑定。</p>

          <label>
            <span>姓名</span>
            <input
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
              placeholder="例如：张经理"
            />
          </label>

          <label>
            <span>邮箱</span>
            <input
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="name@company.com"
            />
          </label>

          <label>
            <span>角色</span>
            <select
              value={roleId}
              onChange={(event) =>
                setRoleId(event.target.value)
              }
            >
              {roles.map((role) => (
                <option
                  key={role.id}
                  value={role.id}
                >
                  {role.name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="primaryOrgButton"
            disabled={creatingMember}
            onClick={() => void createMember()}
          >
            {creatingMember
              ? "添加中…"
              : "添加企业成员"}
          </button>
        </article>
      </div>

      <div className="orgGrid lower">
        <article className="orgPanel">
          <div className="orgPanelHeading">
            <div>
              <h3>角色与权限</h3>
              <p>权限粒度采用 capability-style 标识，可继续下沉到页面、字段和动作级。</p>
            </div>
          </div>

          <div className="roleGrid">
            {roles.map((role) => (
              <div
                className="roleCard"
                key={role.id}
              >
                <div>
                  <strong>{role.name}</strong>
                  {role.system && (
                    <span>系统角色</span>
                  )}
                </div>
                <code>
                  {role.permissions.includes("*")
                    ? "全部权限"
                    : role.permissions.join(" · ") ||
                      "无权限"}
                </code>
              </div>
            ))}
          </div>

          <div className="customRoleForm">
            <input
              value={customRoleName}
              onChange={(event) =>
                setCustomRoleName(event.target.value)
              }
              placeholder="自定义角色名称"
            />
            <input
              value={customPermissions}
              onChange={(event) =>
                setCustomPermissions(event.target.value)
              }
              placeholder="权限逗号分隔，例如 apps.read,data.read"
            />
            <button
              onClick={() => void createRole()}
            >
              创建角色
            </button>
          </div>
        </article>

        <article className="orgPanel auditPanel">
          <h3>权限审计</h3>
          <p>记录组织成员、角色和应用授权的关键变更。</p>

          <div className="auditList">
            {data.audit.length === 0 ? (
              <div className="auditEmpty">
                暂无审计事件
              </div>
            ) : (
              data.audit.slice(0, 12).map((event) => (
                <div key={event.id}>
                  <strong>{event.action}</strong>
                  <span>
                    {event.subjectType}
                    {event.subjectId
                      ? ` · ${event.subjectId}`
                      : ""}
                  </span>
                  <small>{event.createdAt}</small>
                </div>
              ))
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
