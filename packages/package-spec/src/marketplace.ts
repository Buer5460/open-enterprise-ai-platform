import type {
  OEAPBaseManifest,
  OEAPPackageType
} from "./base.js";

export type MarketplacePricingModel =
  | "free"
  | "one-time"
  | "subscription"
  | "metered"
  | "contact-sales";

export type MarketplaceBillingInterval =
  | "month"
  | "year";

export type MarketplaceVisibility =
  | "public"
  | "unlisted"
  | "private";

export type MarketplaceListingStatus =
  | "draft"
  | "published"
  | "suspended"
  | "archived";

export type MarketplaceLicenseModel =
  | "open-source"
  | "commercial"
  | "proprietary";

export interface MarketplacePricingPlan {
  id: string;
  name: string;
  model: MarketplacePricingModel;
  description?: string;
  currency?: string;
  amountMinor?: number;
  interval?: MarketplaceBillingInterval;
  unit?: string;
  includedUnits?: number;
  overageAmountMinor?: number;
  trialDays?: number;
}

export interface MarketplaceLicense {
  model: MarketplaceLicenseModel;
  spdxId?: string;
  termsUrl?: string;
  requiresEntitlement?: boolean;
}

export interface MarketplacePublisherProfile {
  id: string;
  displayName: string;
  description?: string;
  website?: string;
  supportUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
  verified?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface MarketplaceRatingSummary {
  average: number;
  count: number;
}

export interface MarketplaceListing {
  id: string;
  packageId: string;
  packageType: OEAPPackageType;
  slug: string;
  displayName: string;
  summary: string;
  publisherId: string;
  latestVersion: string;
  tags?: string[];
  categories?: string[];
  pricing: MarketplacePricingPlan[];
  license?: MarketplaceLicense;
  visibility: MarketplaceVisibility;
  status: MarketplaceListingStatus;
  verified?: boolean;
  installCount?: number;
  rating?: MarketplaceRatingSummary;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceArtifact {
  packageId: string;
  version: string;
  downloadUrl: string;
  sha256: string;
  signature?: string;
  provenanceUrl?: string;
  manifest: OEAPBaseManifest;
  changelog?: string;
  publishedAt: string;
}

export interface MarketplaceSearchRequest {
  q?: string;
  type?: OEAPPackageType;
  publisherId?: string;
  pricingModel?: MarketplacePricingModel;
  tags?: string[];
  categories?: string[];
  limit?: number;
  cursor?: string;
}

export interface MarketplaceSearchResponse {
  items: MarketplaceListing[];
  nextCursor?: string;
}

export interface MarketplaceValidationResult {
  valid: boolean;
  errors: string[];
}

export const MARKETPLACE_REGISTRY_API_VERSION = "v1" as const;

const registryBase =
  `/${MARKETPLACE_REGISTRY_API_VERSION}`;

export const marketplaceRegistryRoutes = {
  listings:
    `${registryBase}/listings`,
  listing: (packageId: string) =>
    `${registryBase}/listings/${segment(packageId)}`,
  versions: (packageId: string) =>
    `${registryBase}/listings/${segment(packageId)}/versions`,
  version: (
    packageId: string,
    version: string
  ) =>
    `${registryBase}/listings/${segment(packageId)}/versions/${segment(version)}`,
  publisher: (publisherId: string) =>
    `${registryBase}/publishers/${segment(publisherId)}`
} as const;

export function validateMarketplaceListing(
  listing: MarketplaceListing
): MarketplaceValidationResult {
  const errors: string[] = [];

  requireText(errors, listing.id, "id");
  requireText(errors, listing.packageId, "packageId");
  requireText(errors, listing.displayName, "displayName");
  requireText(errors, listing.summary, "summary");
  requireText(errors, listing.publisherId, "publisherId");
  requireText(errors, listing.latestVersion, "latestVersion");
  requireText(errors, listing.createdAt, "createdAt");
  requireText(errors, listing.updatedAt, "updatedAt");

  if (!slugPattern.test(listing.slug)) {
    errors.push(
      "slug must contain lowercase letters, digits and single hyphen-separated segments"
    );
  }

  if (!Array.isArray(listing.pricing) || listing.pricing.length === 0) {
    errors.push("pricing must contain at least one plan");
  } else {
    const planIds = new Set<string>();

    listing.pricing.forEach((plan, index) => {
      const prefix = `pricing[${index}]`;

      requireText(errors, plan.id, `${prefix}.id`);
      requireText(errors, plan.name, `${prefix}.name`);

      if (planIds.has(plan.id)) {
        errors.push(`duplicate pricing plan id: ${plan.id}`);
      }
      planIds.add(plan.id);

      validatePricingPlan(errors, plan, prefix);
    });
  }

  if (
    listing.installCount !== undefined &&
    !isNonNegativeInteger(listing.installCount)
  ) {
    errors.push("installCount must be a non-negative integer");
  }

  if (listing.rating) {
    if (
      !Number.isFinite(listing.rating.average) ||
      listing.rating.average < 0 ||
      listing.rating.average > 5
    ) {
      errors.push("rating.average must be between 0 and 5");
    }

    if (!isNonNegativeInteger(listing.rating.count)) {
      errors.push("rating.count must be a non-negative integer");
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function validatePricingPlan(
  errors: string[],
  plan: MarketplacePricingPlan,
  prefix: string
): void {
  if (
    plan.currency !== undefined &&
    !currencyPattern.test(plan.currency)
  ) {
    errors.push(`${prefix}.currency must be a three-letter uppercase currency code`);
  }

  if (
    plan.amountMinor !== undefined &&
    !isNonNegativeInteger(plan.amountMinor)
  ) {
    errors.push(`${prefix}.amountMinor must be a non-negative integer`);
  }

  if (
    plan.includedUnits !== undefined &&
    !isNonNegativeInteger(plan.includedUnits)
  ) {
    errors.push(`${prefix}.includedUnits must be a non-negative integer`);
  }

  if (
    plan.overageAmountMinor !== undefined &&
    !isNonNegativeInteger(plan.overageAmountMinor)
  ) {
    errors.push(`${prefix}.overageAmountMinor must be a non-negative integer`);
  }

  if (
    plan.trialDays !== undefined &&
    !isNonNegativeInteger(plan.trialDays)
  ) {
    errors.push(`${prefix}.trialDays must be a non-negative integer`);
  }

  switch (plan.model) {
    case "free":
      if (
        plan.amountMinor !== undefined &&
        plan.amountMinor !== 0
      ) {
        errors.push(`${prefix}.amountMinor must be 0 or omitted for free plans`);
      }
      break;

    case "one-time":
      requireMoney(errors, plan, prefix);
      break;

    case "subscription":
      requireMoney(errors, plan, prefix);
      if (!plan.interval) {
        errors.push(`${prefix}.interval is required for subscription plans`);
      }
      break;

    case "metered":
      requireMoney(errors, plan, prefix);
      requireText(errors, plan.unit, `${prefix}.unit`);
      break;

    case "contact-sales":
      break;
  }
}

function requireMoney(
  errors: string[],
  plan: MarketplacePricingPlan,
  prefix: string
): void {
  if (!plan.currency || !currencyPattern.test(plan.currency)) {
    errors.push(`${prefix}.currency is required for paid plans`);
  }

  if (!isNonNegativeInteger(plan.amountMinor)) {
    errors.push(`${prefix}.amountMinor is required for paid plans`);
  }
}

function requireText(
  errors: string[],
  value: string | undefined,
  field: string
): void {
  if (!value?.trim()) {
    errors.push(`${field} is required`);
  }
}

function isNonNegativeInteger(
  value: number | undefined
): value is number {
  return Number.isInteger(value) &&
    (value ?? -1) >= 0;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

const slugPattern =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const currencyPattern =
  /^[A-Z]{3}$/;
