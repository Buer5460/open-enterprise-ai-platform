import type {
  FastifyInstance,
  FastifyRequest
} from "fastify";

import { join } from "node:path";

import {
  AuthSessionStore,
  bearerToken,
  type AuthProviderId
} from "./authStore.js";
import {
  completeAuthorization,
  createAuthorizationRequest,
  providerIsConfigured,
  type ExternalAuthProvider,
  type ExternalIdentity
} from "./oauthFlow.js";
import {
  TenancyStore,
  type OrganizationMember
} from "./tenancyStore.js";

export interface AuthRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
}

type ProviderDescriptor = {
  id: AuthProviderId;
  name: string;
  type: "local" | "oauth2" | "oidc";
  configured: boolean;
  loginEnabled: boolean;
  description: string;
};

export function registerAuthRoutes(
  options: AuthRoutesOptions
) {
  const { app, repoRoot } = options;

  const sessions = new AuthSessionStore(
    join(
      repoRoot,
      ".tmp",
      "auth",
      "sessions.sqlite"
    )
  );

  const tenancy = new TenancyStore(
    join(
      repoRoot,
      ".tmp",
      "tenancy",
      "tenancy.sqlite"
    )
  );

  app.addHook(
    "preHandler",
    async (request, reply) => {
      const production = productionAuthMode();

      if (production) {
        request.headers["x-oeap-org"] =
          "__unauthenticated_org__";
        request.headers["x-oeap-member"] =
          "__unauthenticated_member__";
      }

      const token = bearerToken(
        request.headers.authorization
      );
      const session = token
        ? sessions.get(token)
        : undefined;

      if (session) {
        request.headers["x-oeap-org"] =
          session.organizationId;
        request.headers["x-oeap-member"] =
          session.memberId;
        return;
      }

      if (
        production &&
        !isPublicProductionRequest(request)
      ) {
        return reply.code(401).send({
          ok: false,
          authenticated: false,
          error: "Authentication required"
        });
      }
    }
  );

  app.get(
    "/api/auth/providers",
    async () => ({
      ok: true,
      providers: providerDescriptors(),
      localDevelopmentMode:
        localAuthEnabled(),
      deploymentMode:
        productionAuthMode()
          ? "production"
          : "development"
    })
  );

  app.post<{
    Body: {
      organizationId?: string;
      memberId?: string;
    };
  }>(
    "/api/auth/local",
    async (request, reply) => {
      if (!localAuthEnabled()) {
        return reply.code(403).send({
          ok: false,
          error: "Local development login is disabled"
        });
      }

      const organizationId =
        request.body?.organizationId ??
        "org_local";
      const memberId =
        request.body?.memberId ??
        "member_local_owner";

      try {
        const context =
          tenancy.getContext(organizationId);

        const member = context.members.find(
          (item) => item.id === memberId
        );

        if (!member || member.status !== "active") {
          return reply.code(403).send({
            ok: false,
            error:
              "Member not found or disabled"
          });
        }

        const session = sessions.create({
          provider: "local",
          organizationId,
          memberId,
          email: member.email,
          name: member.name,
          subject: member.id,
          ttlHours: sessionTtlHours()
        });

        return {
          ok: true,
          session: publicSession(session),
          token: session.token,
          organization:
            context.organization,
          member
        };
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error: errorMessage(error)
        });
      }
    }
  );

  app.get(
    "/api/auth/session",
    async (request, reply) => {
      const session = sessionFrom(
        request,
        sessions
      );

      if (!session) {
        return reply.code(401).send({
          ok: false,
          authenticated: false
        });
      }

      try {
        const context = tenancy.getContext(
          session.organizationId
        );
        const member = context.members.find(
          (item) => item.id === session.memberId
        );

        if (!member || member.status !== "active") {
          sessions.revoke(session.token);
          return reply.code(401).send({
            ok: false,
            authenticated: false
          });
        }

        return {
          ok: true,
          authenticated: true,
          session: publicSession(session),
          organization:
            context.organization,
          member
        };
      } catch {
        sessions.revoke(session.token);
        return reply.code(401).send({
          ok: false,
          authenticated: false
        });
      }
    }
  );

  app.post(
    "/api/auth/logout",
    async (request) => {
      const token = bearerToken(
        request.headers.authorization
      );

      if (token) {
        sessions.revoke(token);
      }

      return { ok: true };
    }
  );

  app.get<{
    Params: {
      provider: string;
    };
  }>(
    "/api/auth/:provider/start",
    async (request, reply) => {
      const provider = providerDescriptors()
        .find(
          (item) => item.id === request.params.provider
        );

      if (!provider) {
        return reply.code(404).send({
          ok: false,
          error: "Unknown auth provider"
        });
      }

      if (provider.id === "local") {
        return reply.code(400).send({
          ok: false,
          error:
            "Use POST /api/auth/local for local development login"
        });
      }

      const externalProvider =
        asExternalProvider(provider.id);

      if (
        !externalProvider ||
        !providerIsConfigured(externalProvider)
      ) {
        return reply.code(503).send({
          ok: false,
          error:
            `${provider.name} is not configured`,
          requiredEnvironment:
            requiredEnvironment(provider.id)
        });
      }

      try {
        const authorization =
          await createAuthorizationRequest({
            provider: externalProvider,
            repoRoot,
            apiBase: publicApiBase(request)
          });

        return {
          ok: true,
          provider,
          status: "ready",
          authorizationUrl:
            authorization.authorizationUrl,
          redirectUri:
            authorization.redirectUri,
          expiresAt:
            authorization.expiresAt
        };
      } catch (error) {
        return reply.code(500).send({
          ok: false,
          error: errorMessage(error)
        });
      }
    }
  );

  app.get<{
    Params: {
      provider: string;
    };
    Querystring: {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
  }>(
    "/api/auth/:provider/callback",
    async (request, reply) => {
      const provider = asExternalProvider(
        request.params.provider
      );

      if (!provider) {
        return reply
          .code(404)
          .type("text/html; charset=utf-8")
          .send(
            renderAuthResult(
              "登录失败",
              "未知的企业登录 Provider。"
            )
          );
      }

      if (request.query.error) {
        return reply
          .code(400)
          .type("text/html; charset=utf-8")
          .send(
            renderAuthResult(
              "登录已取消",
              request.query.error_description ||
                request.query.error
            )
          );
      }

      const code = request.query.code?.trim();
      const state = request.query.state?.trim();

      if (!code || !state) {
        return reply
          .code(400)
          .type("text/html; charset=utf-8")
          .send(
            renderAuthResult(
              "登录失败",
              "OAuth 回调缺少 code 或 state。"
            )
          );
      }

      try {
        const identity =
          await completeAuthorization({
            provider,
            repoRoot,
            code,
            state
          });
        const member = resolveExternalMember(
          tenancy,
          identity
        );
        const session = sessions.create({
          provider,
          organizationId: member.organizationId,
          memberId: member.id,
          email: member.email,
          name: member.name,
          subject:
            `${provider}:${identity.subject}`,
          ttlHours: sessionTtlHours()
        });

        const target = sessionRedirectUrl(
          publicWebUrl(),
          session.token
        );

        return reply.redirect(target);
      } catch (error) {
        return reply
          .code(403)
          .type("text/html; charset=utf-8")
          .send(
            renderAuthResult(
              "无法登录企业工作区",
              errorMessage(error)
            )
          );
      }
    }
  );

  return {
    sessions
  };
}

function providerDescriptors(): ProviderDescriptor[] {
  return [
    {
      id: "local",
      name: "Local Development",
      type: "local",
      configured: true,
      loginEnabled: localAuthEnabled(),
      description:
        "Local member session for development and self-hosted bootstrap."
    },
    {
      id: "github",
      name: "GitHub",
      type: "oauth2",
      configured: providerIsConfigured("github"),
      loginEnabled: true,
      description:
        "GitHub OAuth for developers and open-source workspaces."
    },
    {
      id: "google",
      name: "Google Workspace",
      type: "oidc",
      configured: providerIsConfigured("google"),
      loginEnabled: true,
      description:
        "Google Workspace OpenID Connect for enterprise members."
    },
    {
      id: "microsoft",
      name: "Microsoft Entra ID",
      type: "oidc",
      configured: providerIsConfigured("microsoft"),
      loginEnabled: true,
      description:
        "Microsoft Entra ID / Microsoft 365 enterprise SSO."
    },
    {
      id: "oidc",
      name: "Enterprise OIDC",
      type: "oidc",
      configured: providerIsConfigured("oidc"),
      loginEnabled: true,
      description:
        "Generic OIDC adapter for Keycloak, Auth0, Okta and private identity providers."
    }
  ];
}

function requiredEnvironment(
  provider: AuthProviderId
): string[] {
  switch (provider) {
    case "github":
      return [
        "OEAP_GITHUB_CLIENT_ID",
        "OEAP_GITHUB_CLIENT_SECRET"
      ];
    case "google":
      return [
        "OEAP_GOOGLE_CLIENT_ID",
        "OEAP_GOOGLE_CLIENT_SECRET"
      ];
    case "microsoft":
      return [
        "OEAP_MICROSOFT_CLIENT_ID",
        "OEAP_MICROSOFT_CLIENT_SECRET"
      ];
    case "oidc":
      return [
        "OEAP_OIDC_ISSUER",
        "OEAP_OIDC_CLIENT_ID",
        "OEAP_OIDC_CLIENT_SECRET"
      ];
    default:
      return [];
  }
}

export function localAuthEnabled(): boolean {
  const configured =
    process.env.OEAP_LOCAL_AUTH
      ?.trim()
      .toLowerCase();

  if (configured === "enabled") {
    return true;
  }

  if (configured === "disabled") {
    return false;
  }

  return !productionAuthMode();
}

export function productionAuthMode(): boolean {
  return process.env.OEAP_DEPLOYMENT_MODE
    ?.trim()
    .toLowerCase() === "production";
}

function isPublicProductionRequest(
  request: FastifyRequest
): boolean {
  if (request.method === "OPTIONS") {
    return true;
  }

  const route =
    request.routeOptions.url ||
    request.url.split("?")[0];

  if (route === "/health") {
    return true;
  }

  if (route.startsWith("/api/auth/")) {
    return true;
  }

  return (
    route === "/api/invitations/public/:token" ||
    route === "/api/invitations/accept" ||
    route === "/invite/:token"
  );
}

function resolveExternalMember(
  tenancy: TenancyStore,
  identity: ExternalIdentity
): OrganizationMember {
  const email = identity.email
    .trim()
    .toLowerCase();
  const matches = tenancy
    .listOrganizations()
    .flatMap((organization) =>
      tenancy
        .listMembers(organization.id)
        .filter(
          (member) =>
            member.status === "active" &&
            member.email.trim().toLowerCase() === email
        )
    );

  const preferredOrganization =
    process.env.OEAP_DEFAULT_ORG_ID?.trim();

  if (preferredOrganization) {
    const preferred = matches.find(
      (member) =>
        member.organizationId ===
        preferredOrganization
    );

    if (preferred) {
      return preferred;
    }
  }

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length === 0) {
    throw new Error(
      "该登录邮箱尚未加入任何 OEAP 企业组织。请先通过企业邀请加入。"
    );
  }

  throw new Error(
    "该邮箱属于多个企业组织。请设置 OEAP_DEFAULT_ORG_ID 或使用组织专属登录入口。"
  );
}

function asExternalProvider(
  value: string
): ExternalAuthProvider | undefined {
  if (
    value === "github" ||
    value === "google" ||
    value === "microsoft" ||
    value === "oidc"
  ) {
    return value;
  }

  return undefined;
}

function publicApiBase(
  request: FastifyRequest
): string {
  return (
    process.env.OEAP_PUBLIC_API_URL?.trim() ||
    `${request.protocol}://${request.headers.host}`
  ).replace(/\/+$/, "");
}

function publicWebUrl(): string {
  return (
    process.env.OEAP_PUBLIC_WEB_URL?.trim() ||
    process.env.OEAP_WEB_URL?.trim() ||
    "http://127.0.0.1:5173/"
  );
}

function sessionRedirectUrl(
  webUrl: string,
  token: string
): string {
  const base = webUrl.split("#")[0];
  return `${base}#oeap_session=${encodeURIComponent(token)}`;
}

function sessionTtlHours(): number {
  const configured = Number(
    process.env.OEAP_SESSION_TTL_HOURS
  );

  if (
    Number.isFinite(configured) &&
    configured >= 1 &&
    configured <= 24 * 30
  ) {
    return configured;
  }

  return productionAuthMode() ? 8 : 24;
}

function sessionFrom(
  request: FastifyRequest,
  sessions: AuthSessionStore
) {
  const token = bearerToken(
    request.headers.authorization
  );

  return token
    ? sessions.get(token)
    : undefined;
}

function publicSession(session: {
  provider: AuthProviderId;
  organizationId: string;
  memberId: string;
  email?: string;
  name?: string;
  createdAt: string;
  expiresAt: string;
}) {
  return {
    provider: session.provider,
    organizationId: session.organizationId,
    memberId: session.memberId,
    email: session.email,
    name: session.name,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt
  };
}

function renderAuthResult(
  title: string,
  message: string
): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f7fb;color:#172033;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}.card{width:min(520px,100%);background:#fff;border:1px solid #e6ebf2;border-radius:16px;padding:28px;box-shadow:0 18px 60px rgba(27,39,77,.08)}h1{font-size:24px;margin:0 0 10px}p{color:#667085;line-height:1.7;margin:0}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Authentication failed";
}
