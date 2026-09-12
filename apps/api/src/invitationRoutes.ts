import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

import { InvitationStore } from "./invitationStore.js";
import { TenancyStore } from "./tenancyStore.js";
import { AuthSessionStore } from "./authStore.js";
import {
  organizationFrom,
  memberFrom
} from "./tenancyRoutes.js";
import { runtimePath } from "./runtimePaths.js";

export interface InvitationRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
  loadApps: (organizationId?: string) => Promise<any[]>;
}

export function registerInvitationRoutes(
  options: InvitationRoutesOptions
) {
  const tenancyPath = runtimePath(
    options.repoRoot,
    "tenancy",
    "tenancy.sqlite"
  );

  const invitations = new InvitationStore(tenancyPath);
  const tenancy = new TenancyStore(tenancyPath);
  const sessions = new AuthSessionStore(
    runtimePath(
      options.repoRoot,
      "auth",
      "sessions.sqlite"
    )
  );

  const { app } = options;

  app.get(
    "/api/invitations/options",
    async (request, reply) => {
      const identity = requireManager(
        tenancy,
        request,
        reply
      );

      if (!identity) return;

      return {
        ok: true,
        organizationId: identity.organizationId,
        roles: tenancy.listRoles(
          identity.organizationId
        ),
        apps: await options.loadApps(
          identity.organizationId
        )
      };
    }
  );

  app.get(
    "/api/invitations",
    async (request, reply) => {
      const identity = requireManager(
        tenancy,
        request,
        reply
      );

      if (!identity) return;

      return {
        ok: true,
        invitations: invitations.list(
          identity.organizationId
        )
      };
    }
  );

  app.post<{
    Body: {
      email?: string;
      invitedName?: string;
      roleId?: string;
      appIds?: string[];
      expiresHours?: number;
    };
  }>(
    "/api/invitations",
    async (request, reply) => {
      const identity = requireManager(
        tenancy,
        request,
        reply
      );

      if (!identity) return;

      const body = request.body ?? {};

      if (!body.email?.trim() || !body.roleId) {
        return reply.code(400).send({
          ok: false,
          error: "email and roleId are required"
        });
      }

      if (
        Array.isArray(body.appIds) &&
        body.appIds.length === 0
      ) {
        return reply.code(400).send({
          ok: false,
          error:
            "Select at least one app or choose all apps"
        });
      }

      try {
        const created = invitations.create({
          organizationId: identity.organizationId,
          email: body.email,
          invitedName: body.invitedName,
          roleId: body.roleId,
          appIds: body.appIds,
          expiresHours: body.expiresHours,
          createdBy: identity.memberId
        });

        const apiBase =
          process.env.OEAP_PUBLIC_API_URL?.replace(
            /\/$/,
            ""
          ) ||
          `${request.protocol}://${request.headers.host}`;

        return {
          ok: true,
          invitation: created.invitation,
          inviteUrl:
            `${apiBase}/invite/${encodeURIComponent(
              created.token
            )}`
        };
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error: errorMessage(error)
        });
      }
    }
  );

  app.post<{
    Params: {
      invitationId: string;
    };
  }>(
    "/api/invitations/:invitationId/revoke",
    async (request, reply) => {
      const identity = requireManager(
        tenancy,
        request,
        reply
      );

      if (!identity) return;

      const ownedInvitation = invitations
        .list(identity.organizationId)
        .find(
          (item) =>
            item.id === request.params.invitationId
        );

      if (!ownedInvitation) {
        return reply.code(404).send({
          ok: false,
          error: "Invitation not found"
        });
      }

      try {
        return {
          ok: true,
          invitation: invitations.revoke(
            request.params.invitationId,
            identity.memberId
          )
        };
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error: errorMessage(error)
        });
      }
    }
  );

  app.get<{
    Params: { token: string };
  }>(
    "/api/invitations/public/:token",
    async (request, reply) => {
      const invitation = invitations.getPublic(
        request.params.token
      );

      if (!invitation) {
        return reply.code(404).send({
          ok: false,
          error: "Invitation not found"
        });
      }

      return { ok: true, invitation };
    }
  );

  app.post<{
    Body: {
      token?: string;
      name?: string;
    };
  }>(
    "/api/invitations/accept",
    async (request, reply) => {
      const token = request.body?.token?.trim();

      if (!token) {
        return reply.code(400).send({
          ok: false,
          error: "Invitation token is required"
        });
      }

      try {
        const accepted = invitations.accept({
          token,
          name: request.body?.name
        });

        const session = sessions.create({
          provider: "local",
          organizationId:
            accepted.member.organizationId,
          memberId: accepted.member.id,
          email: accepted.member.email,
          name: accepted.member.name,
          subject:
            `invitation:${accepted.invitation.id}`,
          ttlHours: 24
        });

        return {
          ok: true,
          invitation: accepted.invitation,
          member: accepted.member,
          sessionToken: session.token,
          expiresAt: session.expiresAt
        };
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error: errorMessage(error)
        });
      }
    }
  );

  app.get<{
    Params: { token: string };
  }>(
    "/invite/:token",
    async (request, reply) => {
      const invitation = invitations.getPublic(
        request.params.token
      );

      if (!invitation) {
        return reply
          .code(404)
          .type("text/html; charset=utf-8")
          .send(
            renderMessagePage(
              "邀请不存在",
              "该邀请链接无效或已被清理。"
            )
          );
      }

      if (invitation.status !== "pending") {
        return reply
          .type("text/html; charset=utf-8")
          .send(
            renderMessagePage(
              "邀请不可用",
              `当前状态：${escapeHtml(
                invitation.status
              )}`
            )
          );
      }

      const webUrl =
        process.env.OEAP_WEB_URL ||
        "http://127.0.0.1:5173/";

      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderInvitationPage({
            token: request.params.token,
            invitation,
            webUrl
          })
        );
    }
  );
}

function requireManager(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply
): {
  organizationId: string;
  memberId: string;
} | undefined {
  const organizationId = organizationFrom(request);
  const memberId = memberFrom(request);

  try {
    const allowed = tenancy.authorize({
      organizationId,
      memberId,
      permission: "members.manage"
    });

    if (!allowed) {
      reply.code(403).send({
        ok: false,
        error: "Forbidden"
      });
      return undefined;
    }
  } catch {
    reply.code(403).send({
      ok: false,
      error: "Forbidden"
    });
    return undefined;
  }

  return { organizationId, memberId };
}

function renderInvitationPage(input: {
  token: string;
  invitation: {
    organizationName: string;
    email: string;
    invitedName?: string;
    roleName: string;
    appIds: string[];
    expiresAt: string;
  };
  webUrl: string;
}): string {
  const tokenJson = JSON.stringify(input.token);
  const webUrlJson = JSON.stringify(input.webUrl);
  const name =
    input.invitation.invitedName ||
    input.invitation.email.split("@")[0] ||
    "";
  const access =
    input.invitation.appIds.includes("*")
      ? "全部企业应用"
      : `${input.invitation.appIds.length} 个企业应用`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>加入 ${escapeHtml(input.invitation.organizationName)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f7fb;color:#162033}.wrap{min-height:100vh;display:grid;place-items:center;padding:28px}.card{width:min(520px,100%);background:#fff;border:1px solid #e6ebf2;border-radius:18px;padding:30px;box-shadow:0 20px 60px rgba(27,39,77,.08)}.eyebrow{color:#2563eb;font-size:12px;font-weight:800;letter-spacing:1.5px}.card h1{margin:10px 0 8px;font-size:28px}.card p{color:#697386;line-height:1.7}.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:20px 0}.meta div{background:#f8fafc;border-radius:10px;padding:12px}.meta small{display:block;color:#98a1b1}.meta strong{display:block;margin-top:4px;font-size:13px}.card label{display:block;margin:18px 0 6px;font-size:13px;font-weight:700}.card input{width:100%;border:1px solid #dfe4ec;border-radius:10px;padding:12px 13px;font-size:15px;outline:none}.card input:focus{border-color:#2563eb}.button{width:100%;margin-top:18px;border:0;border-radius:10px;background:#2563eb;color:#fff;padding:13px;font-size:15px;font-weight:700;cursor:pointer}.button:disabled{opacity:.6}.message{margin-top:14px;border-radius:9px;padding:11px 12px;background:#eff5ff;color:#315dba;font-size:13px;display:none}.fine{margin-top:16px;color:#98a1b1;font-size:11px;line-height:1.6}@media(max-width:520px){.meta{grid-template-columns:1fr}.card{padding:22px}}
</style>
</head>
<body>
<div class="wrap"><main class="card">
<div class="eyebrow">OEAP ORGANIZATION INVITATION</div>
<h1>加入 ${escapeHtml(input.invitation.organizationName)}</h1>
<p>你已被邀请加入企业工作区。确认姓名后，系统会自动创建成员身份、分配角色和应用访问权限。</p>
<div class="meta">
<div><small>邀请邮箱</small><strong>${escapeHtml(input.invitation.email)}</strong></div>
<div><small>企业角色</small><strong>${escapeHtml(input.invitation.roleName)}</strong></div>
<div><small>应用范围</small><strong>${escapeHtml(access)}</strong></div>
<div><small>有效期至</small><strong>${escapeHtml(input.invitation.expiresAt)}</strong></div>
</div>
<form id="invite-form">
<label for="name">你的姓名</label>
<input id="name" name="name" value="${escapeHtml(name)}" required />
<button class="button" id="submit" type="submit">接受邀请并进入 OEAP</button>
<div class="message" id="message"></div>
</form>
<div class="fine">邀请链接只能使用一次。接受后会创建一个临时登录会话；生产环境可切换为 GitHub、Google、Microsoft Entra ID 或企业 OIDC 登录。</div>
</main></div>
<script>
const inviteToken=${tokenJson};
const webUrl=${webUrlJson};
const form=document.getElementById('invite-form');
const button=document.getElementById('submit');
const message=document.getElementById('message');
form.addEventListener('submit',async(event)=>{
  event.preventDefault();
  button.disabled=true;
  button.textContent='正在加入…';
  message.style.display='none';
  try{
    const response=await fetch('/api/invitations/accept',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:inviteToken,name:document.getElementById('name').value})
    });
    const result=await response.json();
    if(!response.ok||!result.ok){throw new Error(result.error||'接受邀请失败');}
    const separator=webUrl.includes('#')?'&':'#';
    window.location.href=webUrl+separator+'oeap_session='+encodeURIComponent(result.sessionToken);
  }catch(error){
    message.textContent=error instanceof Error?error.message:'接受邀请失败';
    message.style.display='block';
    button.disabled=false;
    button.textContent='接受邀请并进入 OEAP';
  }
});
</script>
</body>
</html>`;
}

function renderMessagePage(
  title: string,
  message: string
): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f7fb;color:#162033;display:grid;place-items:center;min-height:100vh;margin:0}.card{background:#fff;border:1px solid #e6ebf2;border-radius:16px;padding:28px;max-width:520px}.card p{color:#697386}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Invitation operation failed";
}
