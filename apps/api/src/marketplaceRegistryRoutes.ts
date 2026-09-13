import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

import type {
  MarketplaceLicense,
  MarketplacePricingModel,
  MarketplacePricingPlan,
  MarketplacePublisherProfile,
  MarketplaceVisibility,
  OEAPBaseManifest,
  OEAPPackageType
} from "@oeap/package-spec";
import {
  validateMarketplaceListing,
  validatePackageCompatibility
} from "@oeap/package-spec";

import {
  MarketplaceRegistryStore
} from "./marketplaceRegistryStore.js";
import {
  runtimePath
} from "./runtimePaths.js";
import {
  TenancyStore
} from "./tenancyStore.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";

export interface MarketplaceRegistryRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
}

type Identity = {
  organizationId: string;
  memberId: string;
};

type PublisherInput = {
  id?: string;
  displayName?: string;
  description?: string;
  website?: string;
  supportUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
};

type ListingInput = {
  packageType?: OEAPPackageType;
  slug?: string;
  displayName?: string;
  summary?: string;
  publisherId?: string;
  latestVersion?: string;
  tags?: string[];
  categories?: string[];
  pricing?: MarketplacePricingPlan[];
  license?: MarketplaceLicense;
  visibility?: MarketplaceVisibility;
};

type ArtifactInput = {
  version?: string;
  downloadUrl?: string;
  sha256?: string;
  signature?: string;
  provenanceUrl?: string;
  manifest?: OEAPBaseManifest;
  changelog?: string;
};

const packageTypes = new Set<OEAPPackageType>([
  "app",
  "agent",
  "skill",
  "workflow",
  "connector",
  "data-provider"
]);

const pricingModels = new Set<MarketplacePricingModel>([
  "free",
  "one-time",
  "subscription",
  "metered",
  "contact-sales"
]);

export function registerMarketplaceRegistryRoutes(
  options: MarketplaceRegistryRoutesOptions
) {
  const { app, repoRoot } = options;
  const store = new MarketplaceRegistryStore(
    runtimePath(
      repoRoot,
      "marketplace-registry",
      "registry.sqlite"
    )
  );
  const tenancy = new TenancyStore(
    runtimePath(
      repoRoot,
      "tenancy",
      "tenancy.sqlite"
    )
  );

  // Public registry protocol. These routes expose only published public
  // listings; direct lookup also permits published unlisted listings.
  app.get<{
    Querystring: {
      q?: string;
      type?: string;
      publisherId?: string;
      pricingModel?: string;
      tags?: string;
      categories?: string;
      limit?: string;
      cursor?: string;
    };
  }>(
    "/v1/listings",
    async (request, reply) => {
      const type = request.query.type;
      if (
        type &&
        !packageTypes.has(type as OEAPPackageType)
      ) {
        return reply.code(400).send({
          ok: false,
          error: `Unsupported package type: ${type}`
        });
      }

      const pricingModel =
        request.query.pricingModel;
      if (
        pricingModel &&
        !pricingModels.has(
          pricingModel as MarketplacePricingModel
        )
      ) {
        return reply.code(400).send({
          ok: false,
          error:
            `Unsupported pricing model: ${pricingModel}`
        });
      }

      const result = store.searchPublicListings({
        q: request.query.q,
        type: type as OEAPPackageType | undefined,
        publisherId:
          request.query.publisherId,
        pricingModel:
          pricingModel as
            | MarketplacePricingModel
            | undefined,
        tags: csv(request.query.tags),
        categories:
          csv(request.query.categories),
        limit: positiveInteger(
          request.query.limit
        ),
        cursor: request.query.cursor
      });

      return {
        ok: true,
        ...result
      };
    }
  );

  app.get<{
    Params: { packageId: string };
  }>(
    "/v1/listings/:packageId",
    async (request, reply) => {
      const listing = store.getPublicListing(
        request.params.packageId
      );

      if (!listing) {
        return notFound(reply, "Listing not found");
      }

      return {
        ok: true,
        listing
      };
    }
  );

  app.get<{
    Params: { packageId: string };
  }>(
    "/v1/listings/:packageId/versions",
    async (request, reply) => {
      const listing = store.getPublicListing(
        request.params.packageId
      );

      if (!listing) {
        return notFound(reply, "Listing not found");
      }

      return {
        ok: true,
        packageId: listing.packageId,
        versions:
          store.listPublicArtifacts(
            listing.packageId
          )
      };
    }
  );

  app.get<{
    Params: {
      packageId: string;
      version: string;
    };
  }>(
    "/v1/listings/:packageId/versions/:version",
    async (request, reply) => {
      const artifact = store.getPublicArtifact(
        request.params.packageId,
        request.params.version
      );

      if (!artifact) {
        return notFound(reply, "Package version not found");
      }

      return {
        ok: true,
        artifact
      };
    }
  );

  app.get<{
    Params: { publisherId: string };
  }>(
    "/v1/publishers/:publisherId",
    async (request, reply) => {
      const publisher = store.getPublicPublisher(
        request.params.publisherId
      );

      if (!publisher) {
        return notFound(reply, "Publisher not found");
      }

      return {
        ok: true,
        publisher
      };
    }
  );

  // Management API. Ownership is tied to the authenticated OEAP
  // organization and all writes require packages.manage.
  app.get(
    "/api/marketplace/registry",
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
        organizationId:
          identity.organizationId,
        publishers:
          store.listManagedPublishers(
            identity.organizationId
          ),
        listings:
          store.listManagedListings(
            identity.organizationId
          )
      };
    }
  );

  app.post<{
    Body: PublisherInput;
  }>(
    "/api/marketplace/registry/publishers",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      const validation =
        validatePublisherInput(request.body);
      if (validation) {
        return reply.code(400).send({
          ok: false,
          error: validation
        });
      }

      try {
        const publisher = store.upsertPublisher(
          identity.organizationId,
          publisherProfile(request.body)
        );

        return reply.code(201).send({
          ok: true,
          publisher
        });
      } catch (error) {
        return badRequest(reply, error);
      }
    }
  );

  app.put<{
    Params: { publisherId: string };
    Body: PublisherInput;
  }>(
    "/api/marketplace/registry/publishers/:publisherId",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      const body: PublisherInput = {
        ...request.body,
        id: request.params.publisherId
      };
      const validation =
        validatePublisherInput(body);
      if (validation) {
        return reply.code(400).send({
          ok: false,
          error: validation
        });
      }

      try {
        return {
          ok: true,
          publisher: store.upsertPublisher(
            identity.organizationId,
            publisherProfile(body)
          )
        };
      } catch (error) {
        return badRequest(reply, error);
      }
    }
  );

  app.put<{
    Params: { packageId: string };
    Body: ListingInput;
  }>(
    "/api/marketplace/registry/listings/:packageId",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      const validation =
        validateListingInput(request.body);
      if (validation) {
        return reply.code(400).send({
          ok: false,
          error: validation
        });
      }

      const now = new Date().toISOString();
      const body = request.body;
      const listing = {
        id: `listing.${request.params.packageId}`,
        packageId: request.params.packageId,
        packageType: body.packageType!,
        slug: body.slug!.trim(),
        displayName: body.displayName!.trim(),
        summary: body.summary!.trim(),
        publisherId: body.publisherId!.trim(),
        latestVersion: body.latestVersion!.trim(),
        tags: cleanList(body.tags),
        categories: cleanList(body.categories),
        pricing: body.pricing!,
        license: body.license,
        visibility: body.visibility ?? "public" as const,
        status: "draft" as const,
        verified: false,
        installCount: 0,
        rating: {
          average: 0,
          count: 0
        },
        createdAt: now,
        updatedAt: now
      };

      const listingValidation =
        validateMarketplaceListing(listing);
      if (!listingValidation.valid) {
        return reply.code(400).send({
          ok: false,
          errors: listingValidation.errors
        });
      }

      try {
        return {
          ok: true,
          listing: store.upsertListing(
            identity.organizationId,
            listing
          )
        };
      } catch (error) {
        return badRequest(reply, error);
      }
    }
  );

  app.get<{
    Params: { packageId: string };
  }>(
    "/api/marketplace/registry/listings/:packageId",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.read"
      );
      if (!identity) return;

      const listing = store.getManagedListing(
        identity.organizationId,
        request.params.packageId
      );

      if (!listing) {
        return notFound(reply, "Listing not found");
      }

      return {
        ok: true,
        listing,
        versions:
          store.listManagedArtifacts(
            identity.organizationId,
            listing.packageId
          )
      };
    }
  );

  app.post<{
    Params: { packageId: string };
    Body: ArtifactInput;
  }>(
    "/api/marketplace/registry/listings/:packageId/versions",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      const listing = store.getManagedListing(
        identity.organizationId,
        request.params.packageId
      );
      if (!listing) {
        return notFound(reply, "Listing not found");
      }

      const artifactError = validateArtifactInput(
        listing.packageId,
        listing.packageType,
        request.body
      );
      if (artifactError) {
        return reply.code(400).send({
          ok: false,
          error: artifactError
        });
      }

      try {
        const artifact = store.addArtifact(
          identity.organizationId,
          {
            packageId: listing.packageId,
            version: request.body.version!.trim(),
            downloadUrl:
              request.body.downloadUrl!.trim(),
            sha256:
              request.body.sha256!.trim().toLowerCase(),
            signature:
              request.body.signature?.trim() ||
              undefined,
            provenanceUrl:
              request.body.provenanceUrl?.trim() ||
              undefined,
            manifest: request.body.manifest!,
            changelog:
              request.body.changelog?.trim() ||
              undefined,
            publishedAt:
              new Date().toISOString()
          }
        );

        return reply.code(201).send({
          ok: true,
          artifact
        });
      } catch (error) {
        return badRequest(reply, error);
      }
    }
  );

  app.post<{
    Params: { packageId: string };
  }>(
    "/api/marketplace/registry/listings/:packageId/publish",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      const listing = store.getManagedListing(
        identity.organizationId,
        request.params.packageId
      );
      if (!listing) {
        return notFound(reply, "Listing not found");
      }

      const validation =
        validateMarketplaceListing(listing);
      if (!validation.valid) {
        return reply.code(400).send({
          ok: false,
          errors: validation.errors
        });
      }

      try {
        return {
          ok: true,
          listing: store.publishListing(
            identity.organizationId,
            listing.packageId
          )
        };
      } catch (error) {
        return badRequest(reply, error);
      }
    }
  );

  app.post<{
    Params: { packageId: string };
  }>(
    "/api/marketplace/registry/listings/:packageId/unpublish",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "packages.manage"
      );
      if (!identity) return;

      try {
        return {
          ok: true,
          listing: store.unpublishListing(
            identity.organizationId,
            request.params.packageId
          )
        };
      } catch (error) {
        return badRequest(reply, error);
      }
    }
  );

  return store;
}

function requirePermission(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string
): Identity | undefined {
  const organizationId =
    organizationFrom(request);
  const memberId =
    memberFrom(request);

  try {
    if (
      tenancy.authorize({
        organizationId,
        memberId,
        permission
      })
    ) {
      return {
        organizationId,
        memberId
      };
    }
  } catch {
    // Fail closed.
  }

  reply.code(403).send({
    ok: false,
    error: "Forbidden"
  });
  return undefined;
}

function publisherProfile(
  input: PublisherInput
): MarketplacePublisherProfile {
  return {
    id: input.id!.trim(),
    displayName: input.displayName!.trim(),
    description:
      input.description?.trim() || undefined,
    website:
      input.website?.trim() || undefined,
    supportUrl:
      input.supportUrl?.trim() || undefined,
    privacyUrl:
      input.privacyUrl?.trim() || undefined,
    termsUrl:
      input.termsUrl?.trim() || undefined,
    verified: false
  };
}

function validatePublisherInput(
  input: PublisherInput | undefined
): string | undefined {
  if (!input?.id?.trim()) {
    return "publisher id is required";
  }

  if (!publisherIdPattern.test(input.id.trim())) {
    return "publisher id must use lowercase letters, digits, dots, underscores or hyphens";
  }

  if (!input.displayName?.trim()) {
    return "publisher displayName is required";
  }

  for (const [field, value] of [
    ["website", input.website],
    ["supportUrl", input.supportUrl],
    ["privacyUrl", input.privacyUrl],
    ["termsUrl", input.termsUrl]
  ] as const) {
    if (value && !validHttpUrl(value)) {
      return `${field} must be an http(s) URL`;
    }
  }

  return undefined;
}

function validateListingInput(
  input: ListingInput | undefined
): string | undefined {
  if (
    !input?.packageType ||
    !packageTypes.has(input.packageType)
  ) {
    return "valid packageType is required";
  }

  if (!input.slug?.trim()) {
    return "slug is required";
  }

  if (!input.displayName?.trim()) {
    return "displayName is required";
  }

  if (!input.summary?.trim()) {
    return "summary is required";
  }

  if (!input.publisherId?.trim()) {
    return "publisherId is required";
  }

  if (!input.latestVersion?.trim()) {
    return "latestVersion is required";
  }

  if (!Array.isArray(input.pricing) || input.pricing.length === 0) {
    return "pricing must contain at least one plan";
  }

  if (
    input.visibility &&
    !["public", "unlisted", "private"].includes(
      input.visibility
    )
  ) {
    return "unsupported visibility";
  }

  return undefined;
}

function validateArtifactInput(
  packageId: string,
  packageType: OEAPPackageType,
  input: ArtifactInput | undefined
): string | undefined {
  if (!input?.version?.trim()) {
    return "version is required";
  }

  if (!input.downloadUrl?.trim()) {
    return "downloadUrl is required";
  }

  if (!validHttpUrl(input.downloadUrl)) {
    return "downloadUrl must be an http(s) URL";
  }

  if (
    !input.sha256?.trim() ||
    !sha256Pattern.test(input.sha256.trim())
  ) {
    return "sha256 must contain 64 hexadecimal characters";
  }

  if (!input.manifest) {
    return "manifest is required";
  }

  if (input.manifest.id !== packageId) {
    return "manifest id must match package id";
  }

  if (input.manifest.type !== packageType) {
    return "manifest type must match listing package type";
  }

  if (input.manifest.version !== input.version.trim()) {
    return "manifest version must match artifact version";
  }

  const compatibility =
    validatePackageCompatibility(input.manifest);
  const compatibilityError =
    compatibility.issues.find(
      (issue) => issue.severity === "error"
    );

  if (compatibilityError) {
    return compatibilityError.message;
  }

  if (
    input.provenanceUrl &&
    !validHttpUrl(input.provenanceUrl)
  ) {
    return "provenanceUrl must be an http(s) URL";
  }

  return undefined;
}

function csv(
  value: string | undefined
): string[] | undefined {
  const result = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return result?.length
    ? [...new Set(result)]
    : undefined;
}

function cleanList(
  values: string[] | undefined
): string[] {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ];
}

function positiveInteger(
  value: string | undefined
): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : undefined;
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ||
      url.protocol === "http:";
  } catch {
    return false;
  }
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

function badRequest(
  reply: FastifyReply,
  error: unknown
) {
  return reply.code(400).send({
    ok: false,
    error:
      error instanceof Error
        ? error.message
        : "Marketplace registry operation failed"
  });
}

const publisherIdPattern =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

const sha256Pattern =
  /^[a-fA-F0-9]{64}$/;
