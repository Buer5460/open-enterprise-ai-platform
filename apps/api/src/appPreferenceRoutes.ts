import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

import {
  AppPreferenceStore
} from "./appPreferenceStore.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";
import {
  TenancyStore
} from "./tenancyStore.js";
import {
  runtimePath
} from "./runtimePaths.js";

export function registerAppPreferenceRoutes(input: {
  app: FastifyInstance;
  repoRoot: string;
  loadApps: (organizationId?: string) => Promise<any[]>;
}) {
  const store = new AppPreferenceStore(
    runtimePath(
      input.repoRoot,
      "workspace",
      "app-preferences.sqlite"
    )
  );
  const tenancy = new TenancyStore(
    runtimePath(
      input.repoRoot,
      "tenancy",
      "tenancy.sqlite"
    )
  );

  input.app.get(
    "/api/app-preferences",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "apps.read"
      );
      if (!identity) return;

      const allowedApps = new Set(
        (await input.loadApps(identity.organizationId))
          .filter((item) =>
            can(
              tenancy,
              identity,
              "apps.read",
              item.id
            )
          )
          .map((item) => String(item.id))
      );

      return {
        ok: true,
        preferences: store
          .list(
            identity.organizationId,
            identity.memberId
          )
          .filter((item) =>
            allowedApps.has(item.appId)
          )
      };
    }
  );

  input.app.put<{
    Params: { appId: string };
    Body: {
      favorite?: boolean;
      folder?: string | null;
    };
  }>(
    "/api/app-preferences/:appId",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "apps.read",
        request.params.appId
      );
      if (!identity) return;

      if (
        !(await appExists(
          input.loadApps,
          identity.organizationId,
          request.params.appId
        ))
      ) {
        return reply.code(404).send({
          ok: false,
          error: "App not found"
        });
      }

      if (
        request.body?.favorite === undefined &&
        request.body?.folder === undefined
      ) {
        return reply.code(400).send({
          ok: false,
          error: "favorite or folder is required"
        });
      }

      if (
        request.body?.folder !== undefined &&
        request.body.folder !== null &&
        typeof request.body.folder !== "string"
      ) {
        return reply.code(400).send({
          ok: false,
          error: "folder must be a string or null"
        });
      }

      return {
        ok: true,
        preference: store.update({
          organizationId:
            identity.organizationId,
          memberId: identity.memberId,
          appId: request.params.appId,
          favorite:
            request.body?.favorite,
          folder:
            request.body?.folder
        })
      };
    }
  );

  input.app.post<{
    Params: { appId: string };
  }>(
    "/api/app-preferences/:appId/open",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "apps.read",
        request.params.appId
      );
      if (!identity) return;

      if (
        !(await appExists(
          input.loadApps,
          identity.organizationId,
          request.params.appId
        ))
      ) {
        return reply.code(404).send({
          ok: false,
          error: "App not found"
        });
      }

      return {
        ok: true,
        preference: store.markOpened({
          organizationId:
            identity.organizationId,
          memberId: identity.memberId,
          appId: request.params.appId
        })
      };
    }
  );

  return store;
}

async function appExists(
  loadApps: (organizationId?: string) => Promise<any[]>,
  organizationId: string,
  appId: string
): Promise<boolean> {
  return (await loadApps(organizationId))
    .some((item) => item.id === appId);
}

type Identity = {
  organizationId: string;
  memberId: string;
};

function requirePermission(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string,
  appId?: string
): Identity | undefined {
  const identity = {
    organizationId: organizationFrom(request),
    memberId: memberFrom(request)
  };

  if (!can(
    tenancy,
    identity,
    permission,
    appId
  )) {
    return forbidden(reply);
  }

  return identity;
}

function can(
  tenancy: TenancyStore,
  identity: Identity,
  permission: string,
  appId?: string
): boolean {
  try {
    return tenancy.authorize({
      organizationId: identity.organizationId,
      memberId: identity.memberId,
      permission,
      appId
    });
  } catch {
    return false;
  }
}

function forbidden(
  reply: FastifyReply
) {
  reply.code(403).send({
    ok: false,
    error: "Forbidden"
  });
  return undefined;
}
