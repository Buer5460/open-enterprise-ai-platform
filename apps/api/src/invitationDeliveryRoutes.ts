import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { join } from "node:path";

import {
  InvitationStore,
  type OrganizationInvitation
} from "./invitationStore.js";
import {
  InvitationDeliveryStore
} from "./invitationDeliveryStore.js";
import {
  MailDeliveryService,
  type MailDeliveryResult
} from "./mailDelivery.js";
import {
  TenancyStore
} from "./tenancyStore.js";
import {
  organizationFrom,
  memberFrom
} from "./tenancyRoutes.js";

export interface InvitationDeliveryRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
}

export function registerInvitationDeliveryRoutes(
  options: InvitationDeliveryRoutesOptions
) {
  const tenancyPath = join(
    options.repoRoot,
    ".tmp",
    "tenancy",
    "tenancy.sqlite"
  );

  const invitations =
    new InvitationStore(tenancyPath);
  const tenancy =
    new TenancyStore(tenancyPath);
  const deliveryStore =
    new InvitationDeliveryStore(tenancyPath);
  const mail = new MailDeliveryService();
  const { app } = options;

  app.addHook(
    "onSend",
    async (request, reply, payload) => {
      if (
        request.method !== "POST" ||
        request.routeOptions.url !== "/api/invitations" ||
        reply.statusCode >= 300
      ) {
        return payload;
      }

      const parsed = parseJsonPayload(payload);
      if (
        !parsed?.ok ||
        !parsed.invitation?.id ||
        !parsed.inviteUrl
      ) {
        return payload;
      }

      const invitation =
        parsed.invitation as OrganizationInvitation;
      const token = tokenFromInviteUrl(
        String(parsed.inviteUrl)
      );

      if (token) {
        deliveryStore.saveToken(
          invitation.id,
          token
        );
      }

      const delivery = await deliverInvitation({
        mail,
        deliveryStore,
        invitation,
        inviteUrl: String(parsed.inviteUrl),
        kind: "invitation"
      });

      return JSON.stringify({
        ...parsed,
        delivery
      });
    }
  );

  app.get(
    "/api/invitations/delivery-status",
    async (request, reply) => {
      const identity = requireManager(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      return {
        ok: true,
        mail: mail.status(),
        events: deliveryStore.listEvents(
          identity.organizationId,
          50
        )
      };
    }
  );

  app.post<{
    Params: {
      invitationId: string;
    };
  }>(
    "/api/invitations/:invitationId/resend-email",
    async (request, reply) => {
      const identity = requireManager(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const invitation = invitations
        .list(identity.organizationId)
        .find(
          (item) =>
            item.id === request.params.invitationId
        );

      if (!invitation) {
        return reply.code(404).send({
          ok: false,
          error: "Invitation not found"
        });
      }

      if (invitation.status !== "pending") {
        return reply.code(400).send({
          ok: false,
          error:
            `Only pending invitations can be resent (${invitation.status})`
        });
      }

      const token = deliveryStore.getToken(
        invitation.id
      );

      if (!token) {
        return reply.code(409).send({
          ok: false,
          error:
            "This invitation predates secure delivery storage. Create a new invitation to enable resend."
        });
      }

      const inviteUrl = buildInviteUrl(
        request,
        token
      );
      const delivery = await deliverInvitation({
        mail,
        deliveryStore,
        invitation,
        inviteUrl,
        kind: "resend"
      });

      return {
        ok: delivery.ok,
        invitation,
        inviteUrl,
        delivery
      };
    }
  );

  app.post<{
    Body: {
      withinHours?: number;
    };
  }>(
    "/api/invitations/remind-due",
    async (request, reply) => {
      const identity = requireManager(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const withinHours = Math.max(
        1,
        Math.min(
          Number(request.body?.withinHours ?? 24) || 24,
          24 * 7
        )
      );
      const deadline =
        Date.now() + withinHours * 60 * 60 * 1000;

      const due = invitations
        .list(identity.organizationId)
        .filter(
          (item) =>
            item.status === "pending" &&
            new Date(item.expiresAt).getTime() <= deadline
        );

      const results: Array<{
        invitationId: string;
        email: string;
        delivery: MailDeliveryResult;
      }> = [];

      for (const invitation of due) {
        const token = deliveryStore.getToken(
          invitation.id
        );

        if (!token) {
          results.push({
            invitationId: invitation.id,
            email: invitation.email,
            delivery: {
              ok: false,
              provider:
                mail.status().activeProvider,
              status: "failed",
              error:
                "No recoverable invitation token is available for this legacy invitation."
            }
          });
          continue;
        }

        const delivery = await deliverInvitation({
          mail,
          deliveryStore,
          invitation,
          inviteUrl: buildInviteUrl(
            request,
            token
          ),
          kind: "reminder"
        });

        results.push({
          invitationId: invitation.id,
          email: invitation.email,
          delivery
        });
      }

      return {
        ok: true,
        withinHours,
        matched: due.length,
        sent: results.filter(
          (item) => item.delivery.status === "sent"
        ).length,
        manual: results.filter(
          (item) => item.delivery.status === "manual"
        ).length,
        failed: results.filter(
          (item) => item.delivery.status === "failed"
        ).length,
        results
      };
    }
  );
}

async function deliverInvitation(input: {
  mail: MailDeliveryService;
  deliveryStore: InvitationDeliveryStore;
  invitation: OrganizationInvitation;
  inviteUrl: string;
  kind: "invitation" | "resend" | "reminder";
}): Promise<MailDeliveryResult> {
  const message = invitationMessage(
    input.invitation,
    input.inviteUrl,
    input.kind
  );
  const result = await input.mail.send(message);

  input.deliveryStore.recordEvent({
    invitationId: input.invitation.id,
    organizationId:
      input.invitation.organizationId,
    provider: result.provider,
    status: result.status,
    error: result.error
  });

  return result;
}

function invitationMessage(
  invitation: OrganizationInvitation,
  inviteUrl: string,
  kind: "invitation" | "resend" | "reminder"
) {
  const prefix =
    kind === "reminder"
      ? "提醒："
      : kind === "resend"
        ? "重新发送："
        : "";
  const subject =
    `${prefix}加入 ${invitation.organizationName} 的 OEAP 企业工作区`;
  const access = invitation.appIds.includes("*")
    ? "全部企业应用"
    : `${invitation.appIds.length} 个指定应用`;
  const name =
    invitation.invitedName ||
    invitation.email.split("@")[0] ||
    "成员";

  const text = [
    `${name}，你好。`,
    "",
    `你已被邀请加入 ${invitation.organizationName}。`,
    `角色：${invitation.roleName}`,
    `应用范围：${access}`,
    `有效期至：${invitation.expiresAt}`,
    "",
    `接受邀请：${inviteUrl}`,
    "",
    "该链接仅供受邀成员使用。"
  ].join("\n");

  const html = `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#172033"><div style="max-width:620px;margin:0 auto;padding:32px 18px"><div style="background:white;border:1px solid #e6ebf2;border-radius:16px;padding:28px"><div style="font-size:12px;font-weight:800;letter-spacing:1.4px;color:#2563eb">OEAP ENTERPRISE INVITATION</div><h1 style="font-size:24px;margin:12px 0 8px">加入 ${escapeHtml(invitation.organizationName)}</h1><p style="color:#667085;line-height:1.7">${escapeHtml(name)}，你已被邀请加入企业工作区。</p><div style="background:#f8fafc;border-radius:10px;padding:14px;margin:18px 0;line-height:1.8"><strong>角色：</strong>${escapeHtml(invitation.roleName)}<br/><strong>应用范围：</strong>${escapeHtml(access)}<br/><strong>有效期至：</strong>${escapeHtml(invitation.expiresAt)}</div><a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:700">接受邀请并进入 OEAP</a><p style="font-size:12px;color:#98a1b1;margin-top:18px;line-height:1.6">如果你不认识发送方，请忽略此邮件。邀请链接只能用于加入指定企业工作区。</p></div></div></body></html>`;

  return {
    to: invitation.email,
    subject,
    text,
    html
  };
}

function buildInviteUrl(
  request: FastifyRequest,
  token: string
): string {
  const apiBase =
    process.env.OEAP_PUBLIC_API_URL?.replace(
      /\/$/,
      ""
    ) ||
    `${request.protocol}://${request.headers.host}`;

  return `${apiBase}/invite/${encodeURIComponent(token)}`;
}

function tokenFromInviteUrl(
  inviteUrl: string
): string | undefined {
  try {
    const url = new URL(inviteUrl);
    const parts = url.pathname
      .split("/")
      .filter(Boolean);
    const token = parts[parts.length - 1];
    return token
      ? decodeURIComponent(token)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonPayload(
  payload: unknown
): any | undefined {
  try {
    if (typeof payload === "string") {
      return JSON.parse(payload);
    }

    if (Buffer.isBuffer(payload)) {
      return JSON.parse(
        payload.toString("utf8")
      );
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function requireManager(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply
): {
  organizationId: string;
  memberId: string;
} | undefined {
  const organizationId =
    organizationFrom(request);
  const memberId = memberFrom(request);

  try {
    if (!tenancy.authorize({
      organizationId,
      memberId,
      permission: "members.manage"
    })) {
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

  return {
    organizationId,
    memberId
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
