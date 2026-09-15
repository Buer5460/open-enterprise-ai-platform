import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

import type {
  MarketplaceArtifact,
  MarketplaceLicense,
  MarketplaceListing,
  MarketplacePricingPlan,
  OEAPPackageType
} from "@oeap/package-spec";
import type {
  MarketplaceRegistry
} from "@oeap/marketplace-registry";

import {
  MarketplacePublishingStore,
  MarketplacePublishingValidationError,
  normalizePackageSlug
} from "./marketplacePublishingStore.js";
import { TenancyStore } from "./tenancyStore.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";
import { runtimePath } from "./runtimePaths.js";

const packageTypes: OEAPPackageType[] = [
  "app",
  "agent",
  "skill",
  "workflow",
  "connector",
  "data-provider"
];

export function registerMarketplacePublishingRoutes(input: {
  app: FastifyInstance;
  repoRoot: string;
  registry: MarketplaceRegistry;
  store: MarketplacePublishingStore;
}) {
  const tenancy = new TenancyStore(
    runtimePath(
      input.repoRoot,
      "tenancy",
      "tenancy.sqlite"
    )
  );

  input.app.get(
    "/api/marketplace/v1/publisher/account",
    async (request, reply) => {
      const identity = requireManage(tenancy, request, reply);
      if (!identity) return;

      return {
        ok: true,
        publisher: input.store.getPublisherForOrganization(
          identity.organizationId
        )
      };
    }
  );

  input.app.put<{
    Body: {
      publisherId?: string;
      displayName?: string;
      description?: string;
      website?: string;
      supportUrl?: string;
      privacyUrl?: string;
      termsUrl?: string;
    };
  }>(
    "/api/marketplace/v1/publisher/account",
    async (request, reply) => {
      const identity = requireManage(tenancy, request, reply);
      if (!identity) return;

      try {
        const publisher = input.store.upsertPublisher({
          organizationId: identity.organizationId,
          publisherId: request.body?.publisherId ?? "",
          displayName: request.body?.displayName ?? "",
          description: request.body?.description,
          website: request.body?.website,
          supportUrl: request.body?.supportUrl,
          privacyUrl: request.body?.privacyUrl,
          termsUrl: request.body?.termsUrl
        });

        return {
          ok: true,
          publisher
        };
      } catch (error) {
        return publishingError(reply, error);
      }
    }
  );

  input.app.get(
    "/api/marketplace/v1/publisher/submissions",
    async (request, reply) => {
      const identity = requireManage(tenancy, request, reply);
      if (!identity) return;

      return {
        ok: true,
        submissions: input.store.listForOrganization(
          identity.organizationId
        )
      };
    }
  );

  input.app.put<{
    Params: { slug: string };
    Body: {
      packageType?: string;
      displayName?: string;
      summary?: string;
      latestVersion?: string;
      categories?: string[];
      tags?: string[];
      pricing?: MarketplacePricingPlan[];
      license?: MarketplaceLicense;
      artifact?: MarketplaceArtifact;
    };
  }>(
    "/api/marketplace/v1/publisher/listings/:slug",
    async (request, reply) => {
      const identity = requireManage(tenancy, request, reply);
      if (!identity) return;

      const publisher = input.store.getPublisherForOrganization(
        identity.organizationId
      );
      if (!publisher) {
        return reply.code(409).send({
          ok: false,
          error:
            "Create a Marketplace publisher profile before creating listings"
        });
      }

      const packageType = request.body?.packageType;
      if (
        !packageType ||
        !packageTypes.includes(packageType as OEAPPackageType)
      ) {
        return badRequest(reply, "packageType is invalid");
      }

      try {
        const slug = normalizePackageSlug(request.params.slug);
        const packageId = `${publisher.publisherId}.${slug}`;
        const now = new Date().toISOString();
        const existing = input.store.getSubmission(packageId);
        const listing: MarketplaceListing = {
          id: `listing.${publisher.publisherId}.${slug}`,
          packageId,
          packageType: packageType as OEAPPackageType,
          slug,
          displayName:
            request.body?.displayName?.trim() || humanize(slug),
          summary: request.body?.summary?.trim() || "",
          publisherId: publisher.publisherId,
          latestVersion:
            request.body?.latestVersion?.trim() || "0.1.0",
          tags: cleanList(request.body?.tags),
          categories: cleanList(request.body?.categories),
          pricing:
            request.body?.pricing?.length
              ? request.body.pricing
              : [
                  {
                    id: "free",
                    name: "Free",
                    model: "free"
                  }
                ],
          license:
            request.body?.license ?? {
              model: "proprietary",
              requiresEntitlement: true
            },
          visibility: "public",
          status: "draft",
          verified: publisher.verified,
          installCount:
            existing?.listing.installCount ?? 0,
          rating:
            existing?.listing.rating ?? {
              average: 0,
              count: 0
            },
          createdAt:
            existing?.listing.createdAt ?? now,
          updatedAt: now
        };

        const submission = input.store.saveDraft({
          organizationId: identity.organizationId,
          publisherId: publisher.publisherId,
          listing,
          artifact: request.body?.artifact
        });

        return {
          ok: true,
          submission
        };
      } catch (error) {
        return publishingError(reply, error);
      }
    }
  );

  input.app.post<{
    Params: { slug: string };
  }>(
    "/api/marketplace/v1/publisher/listings/:slug/submit",
    async (request, reply) => {
      const identity = requireManage(tenancy, request, reply);
      if (!identity) return;

      const publisher = input.store.getPublisherForOrganization(
        identity.organizationId
      );
      if (!publisher) {
        return reply.code(409).send({
          ok: false,
          error: "Marketplace publisher profile is required"
        });
      }

      try {
        const slug = normalizePackageSlug(request.params.slug);
        const submission = input.store.submit(
          identity.organizationId,
          `${publisher.publisherId}.${slug}`
        );

        return {
          ok: true,
          submission
        };
      } catch (error) {
        return publishingError(reply, error);
      }
    }
  );

  input.app.get(
    "/api/marketplace/v1/review/status",
    async (request, reply) => {
      const identity = requireManage(tenancy, request, reply);
      if (!identity) return;

      return {
        ok: true,
        reviewer: isReviewerOrganization(
          identity.organizationId
        ),
        organizationId: identity.organizationId
      };
    }
  );

  input.app.get(
    "/api/marketplace/v1/review/submissions",
    async (request, reply) => {
      const identity = requireReviewer(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      return {
        ok: true,
        submissions: input.store.listReviewQueue()
      };
    }
  );

  input.app.post<{
    Params: { packageId: string };
    Body: {
      decision?: "approve" | "reject";
      note?: string;
      verifyPublisher?: boolean;
    };
  }>(
    "/api/marketplace/v1/review/submissions/:packageId",
    async (request, reply) => {
      const identity = requireReviewer(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const decision = request.body?.decision;
      if (decision !== "approve" && decision !== "reject") {
        return badRequest(
          reply,
          "decision must be approve or reject"
        );
      }

      try {
        const reviewed = input.store.review({
          packageId: request.params.packageId,
          decision,
          note: request.body?.note,
          verifyPublisher: request.body?.verifyPublisher
        });

        if (decision === "approve") {
          await input.registry.upsertPublisher(
            reviewed.publisher
          );
          await input.registry.upsertListing(
            reviewed.submission.listing
          );
          if (reviewed.submission.artifact) {
            await input.registry.publishArtifact(
              reviewed.submission.artifact
            );
          }
        }

        return {
          ok: true,
          submission: reviewed.submission,
          publisher: reviewed.publisher
        };
      } catch (error) {
        return publishingError(reply, error);
      }
    }
  );
}

function requireManage(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply
) {
  return requirePermission(
    tenancy,
    request,
    reply,
    "packages.manage"
  );
}

function requireReviewer(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const identity = requireManage(tenancy, request, reply);
  if (!identity) return undefined;

  if (!isReviewerOrganization(identity.organizationId)) {
    reply.code(403).send({
      ok: false,
      error: "Marketplace reviewer access is not configured for this organization"
    });
    return undefined;
  }

  return identity;
}

function requirePermission(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string
): { organizationId: string; memberId: string } | undefined {
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

function isReviewerOrganization(
  organizationId: string
): boolean {
  const configured =
    process.env.OEAP_MARKETPLACE_REVIEW_ORGANIZATIONS
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [];

  const allowed =
    configured.length > 0
      ? configured
      : deploymentMode() === "development"
        ? ["org_local"]
        : [];

  return allowed.includes(organizationId);
}

function deploymentMode(): "development" | "production" {
  return process.env.OEAP_DEPLOYMENT_MODE
    ?.trim()
    .toLowerCase() === "production"
    ? "production"
    : "development";
}

function cleanList(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
}

function humanize(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) =>
      part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join(" ");
}

function publishingError(
  reply: FastifyReply,
  error: unknown
) {
  if (error instanceof MarketplacePublishingValidationError) {
    return reply.code(400).send({
      ok: false,
      error: error.message
    });
  }

  throw error;
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
