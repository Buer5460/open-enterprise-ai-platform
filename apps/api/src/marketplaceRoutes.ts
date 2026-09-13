import type {
  FastifyInstance,
  FastifyReply
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

export function registerMarketplaceRoutes(input: {
  app: FastifyInstance;
  registry?: MarketplaceRegistry;
}): MarketplaceRegistry {
  const registry =
    input.registry ?? createOfficialMarketplaceRegistry();

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

  return registry;
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

function notFound(
  reply: FastifyReply,
  error: string
) {
  return reply.code(404).send({
    ok: false,
    error
  });
}
