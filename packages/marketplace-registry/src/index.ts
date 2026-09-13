import {
  validateMarketplaceListing,
  type MarketplaceArtifact,
  type MarketplaceListing,
  type MarketplacePricingModel,
  type MarketplacePublisherProfile,
  type MarketplaceSearchRequest,
  type MarketplaceSearchResponse,
  type OEAPPackageType
} from "@oeap/package-spec";

export interface MarketplaceRegistry {
  upsertPublisher(
    profile: MarketplacePublisherProfile
  ): Promise<void>;

  getPublisher(
    id: string
  ): Promise<MarketplacePublisherProfile | null>;

  upsertListing(
    listing: MarketplaceListing
  ): Promise<void>;

  getListing(
    packageId: string
  ): Promise<MarketplaceListing | null>;

  search(
    request: MarketplaceSearchRequest
  ): Promise<MarketplaceSearchResponse>;

  publishArtifact(
    artifact: MarketplaceArtifact
  ): Promise<void>;

  getArtifact(
    packageId: string,
    version: string
  ): Promise<MarketplaceArtifact | null>;

  listVersions(
    packageId: string
  ): Promise<MarketplaceArtifact[]>;
}

export interface MarketplaceRegistrySeed {
  publishers?: MarketplacePublisherProfile[];
  listings?: MarketplaceListing[];
  artifacts?: MarketplaceArtifact[];
}

export class MarketplaceRegistryValidationError extends Error {
  readonly errors: string[];

  constructor(message: string, errors: string[]) {
    super(message);
    this.name = "MarketplaceRegistryValidationError";
    this.errors = [...errors];
  }
}

export class MarketplaceRegistryQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplaceRegistryQueryError";
  }
}

export class InMemoryMarketplaceRegistry
implements MarketplaceRegistry {
  private readonly publishers =
    new Map<string, MarketplacePublisherProfile>();

  private readonly listings =
    new Map<string, MarketplaceListing>();

  private readonly artifacts =
    new Map<string, Map<string, MarketplaceArtifact>>();

  constructor(seed: MarketplaceRegistrySeed = {}) {
    for (const publisher of seed.publishers ?? []) {
      this.setPublisher(publisher);
    }

    for (const listing of seed.listings ?? []) {
      this.setListing(listing);
    }

    for (const artifact of seed.artifacts ?? []) {
      this.setArtifact(artifact);
    }
  }

  async upsertPublisher(
    profile: MarketplacePublisherProfile
  ): Promise<void> {
    this.setPublisher(profile);
  }

  async getPublisher(
    id: string
  ): Promise<MarketplacePublisherProfile | null> {
    const profile = this.publishers.get(id);
    return profile ? clone(profile) : null;
  }

  async upsertListing(
    listing: MarketplaceListing
  ): Promise<void> {
    this.setListing(listing);
  }

  async getListing(
    packageId: string
  ): Promise<MarketplaceListing | null> {
    const listing = this.listings.get(packageId);
    return listing ? clone(listing) : null;
  }

  async search(
    request: MarketplaceSearchRequest = {}
  ): Promise<MarketplaceSearchResponse> {
    const limit = searchLimit(request.limit);
    const offset = searchOffset(request.cursor);
    const query = normalize(request.q);
    const requestedTags = normalizedList(request.tags);
    const requestedCategories = normalizedList(
      request.categories
    );

    const items = [...this.listings.values()]
      .filter((listing) =>
        listing.visibility === "public" &&
        listing.status === "published"
      )
      .filter((listing) =>
        !request.type || listing.packageType === request.type
      )
      .filter((listing) =>
        !request.publisherId ||
        listing.publisherId === request.publisherId
      )
      .filter((listing) =>
        !request.pricingModel ||
        listing.pricing.some(
          (plan) => plan.model === request.pricingModel
        )
      )
      .filter((listing) =>
        requestedTags.length === 0 ||
        containsAll(listing.tags, requestedTags)
      )
      .filter((listing) =>
        requestedCategories.length === 0 ||
        containsAll(
          listing.categories,
          requestedCategories
        )
      )
      .filter((listing) =>
        !query || listingSearchText(listing).includes(query)
      )
      .sort(compareListings);

    const page = items
      .slice(offset, offset + limit)
      .map(clone);

    const nextOffset = offset + page.length;

    return {
      items: page,
      ...(nextOffset < items.length
        ? { nextCursor: `offset:${nextOffset}` }
        : {})
    };
  }

  async publishArtifact(
    artifact: MarketplaceArtifact
  ): Promise<void> {
    this.setArtifact(artifact);
  }

  async getArtifact(
    packageId: string,
    version: string
  ): Promise<MarketplaceArtifact | null> {
    const artifact =
      this.artifacts.get(packageId)?.get(version);

    return artifact ? clone(artifact) : null;
  }

  async listVersions(
    packageId: string
  ): Promise<MarketplaceArtifact[]> {
    return [
      ...(this.artifacts.get(packageId)?.values() ?? [])
    ]
      .sort((left, right) => {
        const published =
          right.publishedAt.localeCompare(left.publishedAt);
        return published !== 0
          ? published
          : right.version.localeCompare(left.version);
      })
      .map(clone);
  }

  private setPublisher(
    profile: MarketplacePublisherProfile
  ): void {
    const errors: string[] = [];

    requireText(errors, profile.id, "id");
    requireText(
      errors,
      profile.displayName,
      "displayName"
    );

    if (errors.length > 0) {
      throw new MarketplaceRegistryValidationError(
        "Invalid marketplace publisher",
        errors
      );
    }

    this.publishers.set(profile.id, clone(profile));
  }

  private setListing(
    listing: MarketplaceListing
  ): void {
    const validation =
      validateMarketplaceListing(listing);

    if (!validation.valid) {
      throw new MarketplaceRegistryValidationError(
        "Invalid marketplace listing",
        validation.errors
      );
    }

    this.listings.set(
      listing.packageId,
      clone(listing)
    );
  }

  private setArtifact(
    artifact: MarketplaceArtifact
  ): void {
    const errors = validateArtifact(artifact);

    const listing = this.listings.get(
      artifact.packageId
    );

    if (
      listing &&
      listing.packageType !== artifact.manifest.type
    ) {
      errors.push(
        "artifact manifest type must match listing packageType"
      );
    }

    if (errors.length > 0) {
      throw new MarketplaceRegistryValidationError(
        "Invalid marketplace artifact",
        errors
      );
    }

    let versions = this.artifacts.get(
      artifact.packageId
    );

    if (!versions) {
      versions = new Map<string, MarketplaceArtifact>();
      this.artifacts.set(artifact.packageId, versions);
    }

    versions.set(
      artifact.version,
      clone(artifact)
    );
  }
}

const OFFICIAL_PUBLISHED_AT =
  "2026-09-13T00:00:00.000Z";

export const officialMarketplacePublisher:
MarketplacePublisherProfile = {
  id: "oeap-official",
  displayName: "Open Enterprise AI Platform",
  description:
    "Official packages published by Open Enterprise AI Platform.",
  website:
    "https://github.com/Buer5460/open-enterprise-ai-platform",
  supportUrl:
    "https://github.com/Buer5460/open-enterprise-ai-platform/issues",
  verified: true,
  createdAt: OFFICIAL_PUBLISHED_AT,
  updatedAt: OFFICIAL_PUBLISHED_AT
};

export const officialMarketplaceListings:
MarketplaceListing[] = [
  officialListing({
    slug: "company-research",
    type: "skill",
    displayName: "Company Research",
    summary:
      "Research companies from verifiable public and connected sources.",
    categories: ["research", "business-intelligence"],
    tags: ["company", "research", "due-diligence"]
  }),
  officialListing({
    slug: "lead-generation",
    type: "agent",
    displayName: "Lead Generation",
    summary:
      "Turn an ICP into a structured, deduplicated prospect pipeline.",
    categories: ["sales", "growth"],
    tags: ["leads", "prospecting", "b2b"]
  }),
  officialListing({
    slug: "opportunity-radar",
    type: "agent",
    displayName: "Opportunity Radar",
    summary:
      "Detect and score commercial opportunities from market signals.",
    categories: ["business-intelligence", "research"],
    tags: ["opportunity", "signals", "monitoring"]
  }),
  officialListing({
    slug: "business-analysis",
    type: "agent",
    displayName: "Business Analysis",
    summary:
      "Evaluate markets, competitors, economics and execution paths.",
    categories: ["strategy", "business-intelligence"],
    tags: ["market", "strategy", "unit-economics"]
  }),
  officialListing({
    slug: "investment-analysis",
    type: "agent",
    displayName: "Investment Analysis",
    summary:
      "Produce evidence-backed investment analysis, risk checks and memos.",
    categories: ["investment", "research"],
    tags: ["investment", "valuation", "risk"]
  })
];

export function createOfficialMarketplaceRegistry():
MarketplaceRegistry {
  return new InMemoryMarketplaceRegistry({
    publishers: [officialMarketplacePublisher],
    listings: officialMarketplaceListings
  });
}

function officialListing(input: {
  slug: string;
  type: OEAPPackageType;
  displayName: string;
  summary: string;
  categories: string[];
  tags: string[];
}): MarketplaceListing {
  return {
    id: `listing.oeap-official.${input.slug}`,
    packageId: `oeap.${input.slug}`,
    packageType: input.type,
    slug: input.slug,
    displayName: input.displayName,
    summary: input.summary,
    publisherId: "oeap-official",
    latestVersion: "0.1.0",
    tags: [...input.tags],
    categories: [...input.categories],
    pricing: [
      {
        id: "free",
        name: "Free",
        model: "free"
      }
    ],
    license: {
      model: "open-source",
      spdxId: "Apache-2.0",
      requiresEntitlement: false
    },
    visibility: "public",
    status: "published",
    verified: true,
    installCount: 0,
    rating: {
      average: 0,
      count: 0
    },
    createdAt: OFFICIAL_PUBLISHED_AT,
    updatedAt: OFFICIAL_PUBLISHED_AT
  };
}

function validateArtifact(
  artifact: MarketplaceArtifact
): string[] {
  const errors: string[] = [];

  requireText(errors, artifact.packageId, "packageId");
  requireText(errors, artifact.version, "version");
  requireText(errors, artifact.downloadUrl, "downloadUrl");
  requireText(errors, artifact.sha256, "sha256");
  requireText(errors, artifact.publishedAt, "publishedAt");

  if (
    artifact.sha256 &&
    !/^[a-f0-9]{64}$/i.test(artifact.sha256)
  ) {
    errors.push(
      "sha256 must be a 64-character hexadecimal digest"
    );
  }

  if (
    artifact.downloadUrl &&
    !isHttpUrl(artifact.downloadUrl)
  ) {
    errors.push("downloadUrl must use http or https");
  }

  if (
    artifact.publishedAt &&
    !Number.isFinite(Date.parse(artifact.publishedAt))
  ) {
    errors.push("publishedAt must be a valid timestamp");
  }

  if (!artifact.manifest) {
    errors.push("manifest is required");
    return errors;
  }

  if (artifact.manifest.id !== artifact.packageId) {
    errors.push(
      "artifact manifest id must match packageId"
    );
  }

  if (artifact.manifest.version !== artifact.version) {
    errors.push(
      "artifact manifest version must match version"
    );
  }

  return errors;
}

function compareListings(
  left: MarketplaceListing,
  right: MarketplaceListing
): number {
  const verified = Number(Boolean(right.verified)) -
    Number(Boolean(left.verified));

  if (verified !== 0) {
    return verified;
  }

  const installs =
    (right.installCount ?? 0) -
    (left.installCount ?? 0);

  if (installs !== 0) {
    return installs;
  }

  return left.displayName.localeCompare(
    right.displayName
  );
}

function listingSearchText(
  listing: MarketplaceListing
): string {
  return normalize([
    listing.packageId,
    listing.slug,
    listing.displayName,
    listing.summary,
    listing.publisherId,
    ...(listing.tags ?? []),
    ...(listing.categories ?? [])
  ].join(" "));
}

function containsAll(
  source: string[] | undefined,
  requested: string[]
): boolean {
  const values = new Set(
    normalizedList(source)
  );

  return requested.every(
    (value) => values.has(value)
  );
}

function normalizedList(
  values: string[] | undefined
): string[] {
  return (values ?? [])
    .map(normalize)
    .filter(Boolean);
}

function normalize(
  value: string | undefined
): string {
  return value?.trim().toLowerCase() ?? "";
}

function searchLimit(
  value: number | undefined
): number {
  if (value === undefined) {
    return 20;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new MarketplaceRegistryQueryError(
      "limit must be a positive integer"
    );
  }

  return Math.min(value, 100);
}

function searchOffset(
  cursor: string | undefined
): number {
  if (!cursor) {
    return 0;
  }

  const match = /^offset:(\d+)$/.exec(cursor);
  if (!match) {
    throw new MarketplaceRegistryQueryError(
      "cursor is invalid"
    );
  }

  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset)) {
    throw new MarketplaceRegistryQueryError(
      "cursor offset is invalid"
    );
  }

  return offset;
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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" ||
      url.protocol === "https:";
  } catch {
    return false;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export type {
  MarketplaceArtifact,
  MarketplaceListing,
  MarketplacePricingModel,
  MarketplacePublisherProfile,
  MarketplaceSearchRequest,
  MarketplaceSearchResponse
};
