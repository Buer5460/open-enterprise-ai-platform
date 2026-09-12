import type {
  FastifyInstance,
  FastifyRequest
} from "fastify";

import { join } from "node:path";

import {
  TenancyStore,
  type MemberStatus
} from "./tenancyStore.js";

export interface TenancyRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
}

export function registerTenancyRoutes(
  options: TenancyRoutesOptions
) {
  const store = new TenancyStore(
    join(
      options.repoRoot,
      ".tmp",
      "tenancy",
      "tenancy.sqlite"
    )
  );

  const { app } = options;

  app.get(
    "/api/tenancy/organizations",
    async () => ({
      ok: true,
      organizations:
        store.listOrganizations()
    })
  );

  app.post<{
    Body: {
      name?: string;
      slug?: string;
      ownerName?: string;
      ownerEmail?: string;
    };
  }>(
    "/api/tenancy/organizations",
    async (request, reply) => {
      const name =
        request.body?.name?.trim();

      if (!name) {
        return reply
          .code(400)
          .send({
            ok: false,
            error: "organization name is required"
          });
      }

      try {
        return {
          ok: true,
          context:
            store.createOrganization({
              name,
              slug:
                request.body?.slug,
              ownerName:
                request.body?.ownerName,
              ownerEmail:
                request.body?.ownerEmail
            })
        };
      } catch (error) {
        return reply
          .code(400)
          .send({
            ok: false,
            error: errorMessage(error)
          });
      }
    }
  );

  app.get(
    "/api/tenancy/context",
    async (request, reply) => {
      try {
        const organizationId =
          organizationFrom(request);

        return {
          ok: true,
          context:
            store.getContext(
              organizationId
            ),
          currentMemberId:
            memberFrom(request),
          audit:
            store.listAudit(
              organizationId,
              30
            )
        };
      } catch (error) {
        return reply
          .code(404)
          .send({
            ok: false,
            error: errorMessage(error)
          });
      }
    }
  );

  app.post<{
    Body: {
      name?: string;
      permissions?: string[];
    };
  }>(
    "/api/tenancy/roles",
    async (request, reply) => {
      const organizationId =
        organizationFrom(request);
      const actorMemberId =
        memberFrom(request);

      if (
        !authorize(
          store,
          organizationId,
          actorMemberId,
          "org.manage"
        )
      ) {
        return forbidden(reply);
      }

      const name =
        request.body?.name?.trim();

      if (!name) {
        return reply
          .code(400)
          .send({
            ok: false,
            error: "role name is required"
          });
      }

      return {
        ok: true,
        role: store.createRole({
          organizationId,
          name,
          permissions:
            request.body?.permissions ?? [],
          actorMemberId
        })
      };
    }
  );

  app.put<{
    Params: {
      roleId: string;
    };
    Body: {
      name?: string;
      permissions?: string[];
    };
  }>(
    "/api/tenancy/roles/:roleId",
    async (request, reply) => {
      const organizationId =
        organizationFrom(request);
      const actorMemberId =
        memberFrom(request);

      if (
        !authorize(
          store,
          organizationId,
          actorMemberId,
          "org.manage"
        )
      ) {
        return forbidden(reply);
      }

      try {
        return {
          ok: true,
          role: store.updateRole(
            request.params.roleId,
            {
              name:
                request.body?.name,
              permissions:
                request.body?.permissions,
              actorMemberId
            }
          )
        };
      } catch (error) {
        return reply
          .code(400)
          .send({
            ok: false,
            error: errorMessage(error)
          });
      }
    }
  );

  app.post<{
    Body: {
      name?: string;
      email?: string;
      roleId?: string;
      appIds?: string[];
    };
  }>(
    "/api/tenancy/members",
    async (request, reply) => {
      const organizationId =
        organizationFrom(request);
      const actorMemberId =
        memberFrom(request);

      if (
        !authorize(
          store,
          organizationId,
          actorMemberId,
          "members.manage"
        )
      ) {
        return forbidden(reply);
      }

      const body = request.body ?? {};

      if (
        !body.name?.trim() ||
        !body.email?.trim() ||
        !body.roleId
      ) {
        return reply
          .code(400)
          .send({
            ok: false,
            error:
              "name, email and roleId are required"
          });
      }

      try {
        return {
          ok: true,
          member: store.createMember({
            organizationId,
            name: body.name,
            email: body.email,
            roleId: body.roleId,
            appIds: body.appIds,
            actorMemberId
          })
        };
      } catch (error) {
        return reply
          .code(400)
          .send({
            ok: false,
            error: errorMessage(error)
          });
      }
    }
  );

  app.put<{
    Params: {
      memberId: string;
    };
    Body: {
      name?: string;
      email?: string;
      roleId?: string;
      status?: MemberStatus;
    };
  }>(
    "/api/tenancy/members/:memberId",
    async (request, reply) => {
      const organizationId =
        organizationFrom(request);
      const actorMemberId =
        memberFrom(request);

      if (
        !authorize(
          store,
          organizationId,
          actorMemberId,
          "members.manage"
        )
      ) {
        return forbidden(reply);
      }

      try {
        return {
          ok: true,
          member: store.updateMember(
            request.params.memberId,
            {
              ...request.body,
              actorMemberId
            }
          )
        };
      } catch (error) {
        return reply
          .code(400)
          .send({
            ok: false,
            error: errorMessage(error)
          });
      }
    }
  );

  app.put<{
    Params: {
      memberId: string;
    };
    Body: {
      appIds?: string[];
    };
  }>(
    "/api/tenancy/members/:memberId/apps",
    async (request, reply) => {
      const organizationId =
        organizationFrom(request);
      const actorMemberId =
        memberFrom(request);

      if (
        !authorize(
          store,
          organizationId,
          actorMemberId,
          "apps.manage"
        )
      ) {
        return forbidden(reply);
      }

      try {
        return {
          ok: true,
          member:
            store.setMemberAppAccess(
              request.params.memberId,
              request.body?.appIds ?? [],
              actorMemberId
            )
        };
      } catch (error) {
        return reply
          .code(400)
          .send({
            ok: false,
            error: errorMessage(error)
          });
      }
    }
  );

  app.delete<{
    Params: {
      memberId: string;
    };
  }>(
    "/api/tenancy/members/:memberId",
    async (request, reply) => {
      const organizationId =
        organizationFrom(request);
      const actorMemberId =
        memberFrom(request);

      if (
        !authorize(
          store,
          organizationId,
          actorMemberId,
          "members.manage"
        )
      ) {
        return forbidden(reply);
      }

      try {
        store.deleteMember(
          request.params.memberId,
          actorMemberId
        );

        return { ok: true };
      } catch (error) {
        return reply
          .code(400)
          .send({
            ok: false,
            error: errorMessage(error)
          });
      }
    }
  );

  app.get<{
    Querystring: {
      permission?: string;
      appId?: string;
      memberId?: string;
      organizationId?: string;
    };
  }>(
    "/api/tenancy/authorize",
    async (request) => {
      const organizationId =
        request.query.organizationId ||
        organizationFrom(request);
      const memberId =
        request.query.memberId ||
        memberFrom(request);
      const permission =
        request.query.permission ||
        "apps.read";

      return {
        ok: true,
        allowed: store.authorize({
          organizationId,
          memberId,
          permission,
          appId: request.query.appId
        })
      };
    }
  );

  return store;
}

export function organizationFrom(
  request: FastifyRequest
): string {
  const value =
    request.headers["x-oeap-org"];

  return typeof value === "string" &&
    value.trim()
    ? value.trim()
    : "org_local";
}

export function memberFrom(
  request: FastifyRequest
): string {
  const value =
    request.headers["x-oeap-member"];

  return typeof value === "string" &&
    value.trim()
    ? value.trim()
    : "member_local_owner";
}

function authorize(
  store: TenancyStore,
  organizationId: string,
  memberId: string,
  permission: string,
  appId?: string
): boolean {
  try {
    return store.authorize({
      organizationId,
      memberId,
      permission,
      appId
    });
  } catch {
    return false;
  }
}

function forbidden(reply: any) {
  return reply
    .code(403)
    .send({
      ok: false,
      error: "Forbidden"
    });
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Tenancy operation failed";
}
