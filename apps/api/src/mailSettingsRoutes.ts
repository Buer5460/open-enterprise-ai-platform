import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

import {
  MailDeliveryService,
  type MailProviderId
} from "./mailDelivery.js";
import {
  MailSettingsStore
} from "./mailSettingsStore.js";
import { runtimePath } from "./runtimePaths.js";
import {
  TenancyStore
} from "./tenancyStore.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";

export interface MailSettingsRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
}

export function createMailSettingsStore(
  repoRoot: string
): MailSettingsStore {
  return new MailSettingsStore(
    runtimePath(repoRoot, "settings", "mail-settings.enc"),
    runtimePath(repoRoot, "settings", "mail-settings.key")
  );
}

export function registerMailSettingsRoutes(
  options: MailSettingsRoutesOptions
): MailSettingsStore {
  const { app, repoRoot } = options;
  const tenancy = new TenancyStore(
    runtimePath(repoRoot, "tenancy", "tenancy.sqlite")
  );
  const settingsStore =
    createMailSettingsStore(repoRoot);

  app.get(
    "/api/mail/settings",
    async (request, reply) => {
      const identity = requireOrgManager(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const runtime =
        settingsStore.get(
          identity.organizationId
        );
      const mail =
        new MailDeliveryService(runtime);

      return {
        ok: true,
        settings:
          settingsStore.publicView(
            identity.organizationId
          ),
        status: mail.status()
      };
    }
  );

  app.put<{
    Body: {
      provider?: MailProviderId;
      from?: string;
      resendApiKey?: string;
      webhookUrl?: string;
      webhookToken?: string;
      smtpHost?: string;
      smtpPort?: number;
      smtpSecure?: boolean;
      smtpStartTls?: boolean;
      smtpRejectUnauthorized?: boolean;
      smtpUser?: string;
      smtpPassword?: string;
      smtpFrom?: string;
      smtpHelo?: string;
      smtpTimeoutMs?: number;
      clearResendApiKey?: boolean;
      clearWebhookToken?: boolean;
      clearSmtpPassword?: boolean;
    };
  }>(
    "/api/mail/settings",
    async (request, reply) => {
      const identity = requireOrgManager(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      try {
        settingsStore.update(
          identity.organizationId,
          request.body ?? {}
        );

        const runtime = settingsStore.get(
          identity.organizationId
        );

        return {
          ok: true,
          settings:
            settingsStore.publicView(
              identity.organizationId
            ),
          status:
            new MailDeliveryService(
              runtime
            ).status()
        };
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Mail settings update failed"
        });
      }
    }
  );

  app.post<{
    Body: {
      to?: string;
    };
  }>(
    "/api/mail/settings/test",
    async (request, reply) => {
      const identity = requireOrgManager(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const to = request.body?.to?.trim();
      if (!to || !to.includes("@")) {
        return reply.code(400).send({
          ok: false,
          error: "A valid test email is required"
        });
      }

      const mail = new MailDeliveryService(
        settingsStore.get(
          identity.organizationId
        )
      );

      const result = await mail.send({
        to,
        subject: "OEAP 邮件服务测试",
        text:
          "这是一封来自 OpenEnterpriseAI 的邮件服务测试。如果你收到这封邮件，说明当前企业的邮件配置可用。",
        html:
          "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px\"><h2>OEAP 邮件服务测试</h2><p>如果你收到这封邮件，说明当前企业的邮件配置可用。</p></div>"
      });

      return {
        ok: result.ok,
        result,
        status: mail.status()
      };
    }
  );

  return settingsStore;
}

function requireOrgManager(
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
    const allowed = tenancy.authorize({
      organizationId,
      memberId,
      permission: "org.manage"
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

  return {
    organizationId,
    memberId
  };
}
