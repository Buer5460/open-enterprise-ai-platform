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
  TenancyStore
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

      // Production never trusts tenancy identity supplied by the browser.
      // Start every request unauthenticated and only replace these values
      // after validating a server-side session token.
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
          ttlHours: 24
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

      if (!provider.configured) {
        return reply.code(503).send({
          ok: false,
          error:
            `${provider.name} is not configured`,
          requiredEnvironment:
            requiredEnvironment(provider.id)
        });
      }

      return {
        ok: true,
        provider,
        status: "configured",
        message:
          "Provider credentials are configured. OAuth callback exchange will use the provider adapter in the next deployment stage."
      };
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
      configured: Boolean(
        process.env.OEAP_GITHUB_CLIENT_ID &&
        process.env.OEAP_GITHUB_CLIENT_SECRET
      ),
      loginEnabled: true,
      description:
        "GitHub OAuth for developers and open-source workspaces."
    },
    {
      id: "google",
      name: "Google Workspace",
      type: "oidc",
      configured: Boolean(
        process.env.OEAP_GOOGLE_CLIENT_ID &&
        process.env.OEAP_GOOGLE_CLIENT_SECRET
      ),
      loginEnabled: true,
      description:
        "Google Workspace OpenID Connect for enterprise members."
    },
    {
      id: "microsoft",
      name: "Microsoft Entra ID",
      type: "oidc",
      configured: Boolean(
        process.env.OEAP_MICROSOFT_CLIENT_ID &&
        process.env.OEAP_MICROSOFT_CLIENT_SECRET
      ),
      loginEnabled: true,
      description:
        "Microsoft Entra ID / Microsoft 365 enterprise SSO."
    },
    {
      id: "oidc",
      name: "Enterprise OIDC",
      type: "oidc",
      configured: Boolean(
        process.env.OEAP_OIDC_ISSUER &&
        process.env.OEAP_OIDC_CLIENT_ID &&
        process.env.OEAP_OIDC_CLIENT_SECRET
      ),
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

  // Safe default: local bootstrap identity is development-only.
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

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Authentication failed";
}
