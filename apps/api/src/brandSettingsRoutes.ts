import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { join } from "node:path";

import {
  BrandSettingsStore,
  type OrganizationBrandSettings
} from "./brandSettingsStore.js";
import { TenancyStore } from "./tenancyStore.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";

export interface BrandSettingsRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
}

export function createBrandSettingsStore(
  repoRoot: string
): BrandSettingsStore {
  return new BrandSettingsStore(
    join(repoRoot, ".tmp", "settings", "brand-settings.enc"),
    join(repoRoot, ".tmp", "settings", "brand-settings.key")
  );
}

export function registerBrandSettingsRoutes(
  options: BrandSettingsRoutesOptions
): BrandSettingsStore {
  const { app, repoRoot } = options;
  const tenancy = new TenancyStore(
    join(repoRoot, ".tmp", "tenancy", "tenancy.sqlite")
  );
  const store = createBrandSettingsStore(repoRoot);

  app.get(
    "/api/brand/public",
    async () => {
      const organizationId =
        process.env.OEAP_DEFAULT_ORG_ID?.trim() ||
        "org_local";

      let organizationName = "OpenEnterpriseAI";

      try {
        organizationName = tenancy
          .getContext(organizationId)
          .organization.name;
      } catch {
        // Keep generic public branding when the configured org does not exist.
      }

      const stored = store.get(organizationId);

      return {
        ok: true,
        organizationId,
        settings: {
          organizationName:
            stored.organizationName || organizationName,
          shortName:
            stored.shortName || organizationName,
          logoUrl: stored.logoUrl || "",
          primaryColor:
            stored.primaryColor || "#2563EB",
          loginTitle:
            stored.loginTitle || "OpenEnterpriseAI",
          loginSubtitle:
            stored.loginSubtitle || "AI 原生企业应用平台"
        }
      };
    }
  );

  app.get(
    "/api/brand/settings",
    async (request, reply) => {
      const organizationId = organizationFrom(request);
      const memberId = memberFrom(request);

      if (!canReadOrganization(tenancy, organizationId, memberId)) {
        return forbidden(reply);
      }

      const context = tenancy.getContext(organizationId);
      const stored = store.get(organizationId);

      return {
        ok: true,
        canManage: canManageOrganization(
          tenancy,
          organizationId,
          memberId
        ),
        settings: {
          organizationName:
            stored.organizationName || context.organization.name,
          shortName:
            stored.shortName || context.organization.name,
          logoUrl: stored.logoUrl || "",
          primaryColor: stored.primaryColor || "#2563EB",
          loginTitle:
            stored.loginTitle || "OpenEnterpriseAI",
          loginSubtitle:
            stored.loginSubtitle || "AI 原生企业应用平台",
          emailSignature:
            stored.emailSignature || context.organization.name,
          invitationSubject:
            stored.invitationSubject || "邀请加入企业工作区",
          invitationFooter:
            stored.invitationFooter || "由 OpenEnterpriseAI 提供企业 AI 能力",
          updatedAt: stored.updatedAt
        }
      };
    }
  );

  app.put<{
    Body: Partial<OrganizationBrandSettings>;
  }>(
    "/api/brand/settings",
    async (request, reply) => {
      const organizationId = organizationFrom(request);
      const memberId = memberFrom(request);

      if (!canManageOrganization(
        tenancy,
        organizationId,
        memberId
      )) {
        return forbidden(reply);
      }

      try {
        const settings = store.update(
          organizationId,
          request.body ?? {}
        );

        return {
          ok: true,
          settings
        };
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Brand settings update failed"
        });
      }
    }
  );

  return store;
}

function canReadOrganization(
  tenancy: TenancyStore,
  organizationId: string,
  memberId: string
): boolean {
  try {
    return tenancy.authorize({
      organizationId,
      memberId,
      permission: "org.read"
    });
  } catch {
    return false;
  }
}

function canManageOrganization(
  tenancy: TenancyStore,
  organizationId: string,
  memberId: string
): boolean {
  try {
    return tenancy.authorize({
      organizationId,
      memberId,
      permission: "org.manage"
    });
  } catch {
    return false;
  }
}

function forbidden(reply: FastifyReply) {
  return reply.code(403).send({
    ok: false,
    error: "Forbidden"
  });
}
