import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

import {
  marketplaceRegistryRoutes,
  type MarketplacePricingModel,
  type MarketplaceSearchRequest,
  type OEAPPackageType
} from "@oeap/package-spec";

import {
  MarketplaceRegistryQueryError,
  createOfficialMarketplaceRegistry,
  type MarketplaceRegistry
} from "@oeap/marketplace-registry";

import {
  MarketplaceCommerceStore
} from "./marketplaceCommerceStore.js";
import { runtimePath } from "./runtimePaths.js";
import { TenancyStore } from "./tenancyStore.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";

const MARKETPLACE_PREFIX = "/api/marketplace";

const packageTypes: OEAPPackageType[] = [
  "app",
  "agent",
  "skill",
  "workflow",
  "connector",
  "data-provider"
];

const pricingModels: MarketplacePricingModel[] = [
  "free",
  "one-time",
  "subscription",
  "metered",
  "contact-sales"
];

type ListingQuery = {
  q?: string;
  type?: string;
  publisherId?: string;
  pricingModel?: string;
  tags?: string | string[];
  categories?: string | string[];
  limit?: string;
  cursor?: string;
};

type Identity = {
  organizationId: string;
  memberId: string;
};

export function registerMarketplaceRoutes(input: {
  app: FastifyInstance;
  repoRoot: string;
  registry?: MarketplaceRegistry;
  commerce?: MarketplaceCommerceStore;
}): {
  registry: MarketplaceRegistry;
  commerce: MarketplaceCommerceStore;
} {
  const registry =
    input.registry ?? createOfficialMarketplaceRegistry();
  const commerce =
    input.commerce ?? new MarketplaceCommerceStore(
      runtimePath(
        input.repoRoot,
        "marketplace",
        "commerce.sqlite"
      )
    );
  const tenancy = new TenancyStore(
    runtimePath(
      input.repoRoot,
      "tenancy",
      "tenancy.sqlite"
    )
  );

  input.app.get<{
    Querystring: ListingQuery;
  }>(
    `${MARKETPLACE_PREFIX}${marketplaceRegistryRoutes.listings}`,
    async (request, reply) => {
      const parsed = parseSearchRequest(
        request.query ?? {},
        reply
      );

      if (!parsed) {
        return;
      }

      try {
        const result = await registry.search(parsed);
        return {
          ok: true,
          items: result.items,
          nextCursor: result.nextCursor
        };
      } catch (error) {
        if (error instanceof MarketplaceRegistryQueryError) {
          return reply.code(400).send({
            ok: false,
            error: error.message
          });
        }
        throw error;
      }
    }
  );

  input.app.get<{
    Params: { packageId: string };
  }>(
    `${MARKETPLACE_PREFIX}/v1/listings/:packageId`,
    async (request, reply) => {
      const listing = await publicListing(
        registry,
        request.params.packageId
      );

      if (!listing) {
        return notFound(reply, "Marketplace listing not found");
      }

      return {
        ok: true,
        listing
      };
    }
  );

  input.app.get<{
    Params: { packageId: string };
  }>(
    `${MARKETPLACE_PREFIX}/v1/listings/:packageId/versions`,
    async (request, reply) => {
      const listing = await publicListing(
        registry,
        request.params.packageId
      );

      if (!listing) {
        return notFound(reply, "Marketplace listing not found");
      }

      return {
        ok: true,
        packageId: listing.packageId,
        versions: await registry.listVersions(
          listing.packageId
        )
      };
    }
  );

  input.app.get<{
    Params: {
      packageId: string;
      version: string;
    };
  }>(
    `${MARKETPLACE_PREFIX}/v1/listings/:packageId/versions/:version`,
    async (request, reply) => {
      const listing = await publicListing(
        registry,
        request.params.packageId
      );

      if (!listing) {
        return notFound(reply, "Marketplace listing not found");
      }

      const artifact = await registry.getArtifact(
        listing.packageId,
        request.params.version
      );

      if (!artifact) {
        return notFound(reply, "Marketplace artifact not found");
      }

      return {
        ok: true,
        artifact
      };
    }
  );

  input.app.get<{
    Params: { publisherId: string };
  }>(
    `${MARKETPLACE_PREFIX}/v1/publishers/:publisherId`,
    async (request, reply) => {
      const publisher = await registry.getPublisher(
        request.params.publisherId
      );

      if (!publisher) {
        return notFound(reply, "Marketplace publisher not found");
      }

      return {
        ok: true,
        publisher
      };
    }
  );

  input.app.get(
    `${MARKETPLACE_PREFIX}/v1/entitlements`,
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.read"
      );
      if (!identity) return;

      return {
        ok: true,
        organizationId: identity.organizationId,
        entitlements: commerce.listEntitlements(
          identity.organizationId
        )
      };
    }
  );

  input.app.get(
    `${MARKETPLACE_PREFIX}/v1/orders`,
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.read"
      );
      if (!identity) return;

      return {
        ok: true,
        organizationId: identity.organizationId,
        orders: commerce.listOrders(
          identity.organizationId
        )
      };
    }
  );

  input.app.post<{
    Params: { packageId: string };
    Body: { planId?: string };
  }>(
    `${MARKETPLACE_PREFIX}/v1/listings/:packageId/acquire`,
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      const listing = await publicListing(
        registry,
        request.params.packageId
      );

      if (!listing) {
        return notFound(reply, "Marketplace listing not found");
      }

      const existing = commerce.getEntitlement(
        identity.organizationId,
        listing.packageId
      );

      if (existing?.status === "active") {
        return {
          ok: true,
          alreadyOwned: true,
          entitlement: existing
        };
      }

      const planId =
        request.body?.planId?.trim() ||
        listing.pricing[0]?.id;
      const plan = listing.pricing.find(
        (item) => item.id === planId
      );

      if (!plan) {
        return badRequest(
          reply,
          "Marketplace pricing plan not found"
        );
      }

      if (plan.model === "free") {
        const entitlement = commerce.acquireFree({
          organizationId: identity.organizationId,
          packageId: listing.packageId,
          plan
        });

        return reply.code(201).send({
          ok: true,
          paymentRequired: false,
          entitlement
        });
      }

      if (plan.model === "contact-sales") {
        return reply.code(202).send({
          ok: true,
          paymentRequired: false,
          requiresContact: true,
          packageId: listing.packageId,
          plan
        });
      }

      const order = commerce.createPendingOrder({
        organizationId: identity.organizationId,
        packageId: listing.packageId,
        plan,
        provider: "unconfigured"
      });

      return reply.code(202).send({
        ok: true,
        paymentRequired: true,
        paymentProviderConfigured: false,
        order,
        message:
          "Order created. A payment provider must be configured before money can be collected."
      });
    }
  );

  input.app.delete<{
    Params: { packageId: string };
  }>(
    `${MARKETPLACE_PREFIX}/v1/entitlements/:packageId`,
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      const entitlement = commerce.cancelEntitlement(
        identity.organizationId,
        request.params.packageId
      );

      if (!entitlement) {
        return notFound(
          reply,
          "Marketplace entitlement not found"
        );
      }

      return {
        ok: true,
        entitlement
      };
    }
  );

  return { registry, commerce };
}

async function publicListing(
  registry: MarketplaceRegistry,
  packageId: string
) {
  const listing = await registry.getListing(packageId);

  if (
    !listing ||
    listing.visibility !== "public" ||
    listing.status !== "published"
  ) {
    return null;
  }

  return listing;
}

function parseSearchRequest(
  query: ListingQuery,
  reply: FastifyReply
): MarketplaceSearchRequest | undefined {
  if (
    query.type &&
    !packageTypes.includes(query.type as OEAPPackageType)
  ) {
    badRequest(reply, "type is invalid");
    return undefined;
  }

  if (
    query.pricingModel &&
    !pricingModels.includes(
      query.pricingModel as MarketplacePricingModel
    )
  ) {
    badRequest(reply, "pricingModel is invalid");
    return undefined;
  }

  const limit = query.limit === undefined
    ? undefined
    : Number(query.limit);

  if (
    limit !== undefined &&
    (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
  ) {
    badRequest(
      reply,
      "limit must be an integer between 1 and 100"
    );
    return undefined;
  }

  return {
    q: clean(query.q),
    type: query.type as OEAPPackageType | undefined,
    publisherId: clean(query.publisherId),
    pricingModel:
      query.pricingModel as MarketplacePricingModel | undefined,
    tags: list(query.tags),
    categories: list(query.categories),
    limit,
    cursor: clean(query.cursor)
  };
}

function requirePermission(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string
): Identity | undefined {
  const organizationId = organizationFrom(request);
  const memberId = memberFrom(request);

  try {
    if (!tenancy.authorize({
      organizationId,
      memberId,
      permission
    })) {
      return forbidden(reply);
    }
  } catch {
    return forbidden(reply);
  }

  return { organizationId, memberId };
}

function list(
  value: string | string[] | undefined
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parts = Array.isArray(value)
    ? value
    : [value];

  const values = parts
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter(Boolean);

  return values.length > 0
    ? values
    : undefined;
}

function clean(
  value: string | undefined
): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function badRequest(
  reply: FastifyReply,
  error: string
) {
  return reply.code(400).send({
    ok: false,
    error
  });
}

function forbidden(reply: FastifyReply) {
  reply.code(403).send({
    ok: false,
    error: "Forbidden"
  });
  return undefined;
}

function notFound(
  reply: FastifyReply,
  error: string
) {
  return reply.code(404).send({
    ok: false,
    error
  });
}
