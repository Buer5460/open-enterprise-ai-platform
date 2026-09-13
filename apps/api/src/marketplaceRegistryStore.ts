import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  MarketplaceArtifact,
  MarketplaceListing,
  MarketplacePublisherProfile,
  MarketplaceSearchRequest,
  MarketplaceSearchResponse
} from "@oeap/package-spec";

type Row = Record<string, any>;

export class MarketplaceRegistryStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), {
      recursive: true
    });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.createSchema();
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_publishers (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        website TEXT,
        support_url TEXT,
        privacy_url TEXT,
        terms_url TEXT,
        verified INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_marketplace_publishers_org
        ON marketplace_publishers (organization_id, display_name);

      CREATE TABLE IF NOT EXISTS marketplace_listings (
        package_id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL UNIQUE,
        package_type TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        summary TEXT NOT NULL,
        publisher_id TEXT NOT NULL,
        latest_version TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        categories_json TEXT NOT NULL,
        pricing_json TEXT NOT NULL,
        license_json TEXT,
        visibility TEXT NOT NULL,
        status TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        install_count INTEGER NOT NULL DEFAULT 0,
        rating_average REAL NOT NULL DEFAULT 0,
        rating_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (publisher_id)
          REFERENCES marketplace_publishers(id)
          ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_marketplace_listings_public
        ON marketplace_listings (
          status,
          visibility,
          updated_at DESC
        );

      CREATE INDEX IF NOT EXISTS idx_marketplace_listings_publisher
        ON marketplace_listings (
          publisher_id,
          updated_at DESC
        );

      CREATE TABLE IF NOT EXISTS marketplace_versions (
        package_id TEXT NOT NULL,
        version TEXT NOT NULL,
        download_url TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        signature TEXT,
        provenance_url TEXT,
        manifest_json TEXT NOT NULL,
        changelog TEXT,
        published_at TEXT NOT NULL,
        PRIMARY KEY (package_id, version),
        FOREIGN KEY (package_id)
          REFERENCES marketplace_listings(package_id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_marketplace_versions_package
        ON marketplace_versions (
          package_id,
          published_at DESC
        );
    `);
  }

  upsertPublisher(
    organizationId: string,
    profile: MarketplacePublisherProfile
  ): MarketplacePublisherProfile {
    const existing = this.publisherRow(
      profile.id
    );

    if (
      existing &&
      String(existing.organization_id) !==
        organizationId
    ) {
      throw new Error(
        `Publisher is owned by another organization: ${profile.id}`
      );
    }

    const now = new Date().toISOString();
    const createdAt = existing
      ? String(existing.created_at)
      : profile.createdAt ?? now;

    this.db.prepare(`
      INSERT INTO marketplace_publishers (
        id,
        organization_id,
        display_name,
        description,
        website,
        support_url,
        privacy_url,
        terms_url,
        verified,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        website = excluded.website,
        support_url = excluded.support_url,
        privacy_url = excluded.privacy_url,
        terms_url = excluded.terms_url,
        updated_at = excluded.updated_at
    `).run(
      profile.id,
      organizationId,
      profile.displayName,
      profile.description ?? null,
      profile.website ?? null,
      profile.supportUrl ?? null,
      profile.privacyUrl ?? null,
      profile.termsUrl ?? null,
      createdAt,
      now
    );

    return this.requireManagedPublisher(
      organizationId,
      profile.id
    );
  }

  listManagedPublishers(
    organizationId: string
  ): MarketplacePublisherProfile[] {
    return (
      this.db.prepare(`
        SELECT *
        FROM marketplace_publishers
        WHERE organization_id = ?
        ORDER BY display_name ASC, id ASC
      `).all(organizationId) as Row[]
    ).map(publisherFromRow);
  }

  getManagedPublisher(
    organizationId: string,
    publisherId: string
  ): MarketplacePublisherProfile | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM marketplace_publishers
      WHERE id = ?
        AND organization_id = ?
    `).get(
      publisherId,
      organizationId
    ) as Row | undefined;

    return row
      ? publisherFromRow(row)
      : undefined;
  }

  getPublicPublisher(
    publisherId: string
  ): MarketplacePublisherProfile | undefined {
    const row = this.db.prepare(`
      SELECT p.*
      FROM marketplace_publishers p
      WHERE p.id = ?
        AND EXISTS (
          SELECT 1
          FROM marketplace_listings l
          WHERE l.publisher_id = p.id
            AND l.status = 'published'
            AND l.visibility IN (
              'public',
              'unlisted'
            )
        )
    `).get(publisherId) as Row | undefined;

    return row
      ? publisherFromRow(row)
      : undefined;
  }

  upsertListing(
    organizationId: string,
    listing: MarketplaceListing
  ): MarketplaceListing {
    this.requireManagedPublisher(
      organizationId,
      listing.publisherId
    );

    const existing = this.listingRow(
      listing.packageId
    );

    if (existing) {
      const currentPublisher =
        this.publisherRow(
          String(existing.publisher_id)
        );

      if (
        !currentPublisher ||
        String(
          currentPublisher.organization_id
        ) !== organizationId
      ) {
        throw new Error(
          `Listing is owned by another organization: ${listing.packageId}`
        );
      }
    }

    const now = new Date().toISOString();
    const createdAt = existing
      ? String(existing.created_at)
      : listing.createdAt || now;

    this.db.prepare(`
      INSERT INTO marketplace_listings (
        package_id,
        listing_id,
        package_type,
        slug,
        display_name,
        summary,
        publisher_id,
        latest_version,
        tags_json,
        categories_json,
        pricing_json,
        license_json,
        visibility,
        status,
        verified,
        install_count,
        rating_average,
        rating_count,
        created_at,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        0, 0, 0, 0, ?, ?
      )
      ON CONFLICT(package_id) DO UPDATE SET
        listing_id = excluded.listing_id,
        package_type = excluded.package_type,
        slug = excluded.slug,
        display_name = excluded.display_name,
        summary = excluded.summary,
        publisher_id = excluded.publisher_id,
        latest_version = excluded.latest_version,
        tags_json = excluded.tags_json,
        categories_json = excluded.categories_json,
        pricing_json = excluded.pricing_json,
        license_json = excluded.license_json,
        visibility = excluded.visibility,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      listing.packageId,
      listing.id,
      listing.packageType,
      listing.slug,
      listing.displayName,
      listing.summary,
      listing.publisherId,
      listing.latestVersion,
      JSON.stringify(listing.tags ?? []),
      JSON.stringify(
        listing.categories ?? []
      ),
      JSON.stringify(listing.pricing),
      listing.license
        ? JSON.stringify(listing.license)
        : null,
      listing.visibility,
      listing.status,
      createdAt,
      now
    );

    return this.requireManagedListing(
      organizationId,
      listing.packageId
    );
  }

  listManagedListings(
    organizationId: string
  ): MarketplaceListing[] {
    return (
      this.db.prepare(`
        SELECT l.*
        FROM marketplace_listings l
        JOIN marketplace_publishers p
          ON p.id = l.publisher_id
        WHERE p.organization_id = ?
        ORDER BY
          l.updated_at DESC,
          l.package_id ASC
      `).all(organizationId) as Row[]
    ).map(listingFromRow);
  }

  getManagedListing(
    organizationId: string,
    packageId: string
  ): MarketplaceListing | undefined {
    const row = this.db.prepare(`
      SELECT l.*
      FROM marketplace_listings l
      JOIN marketplace_publishers p
        ON p.id = l.publisher_id
      WHERE l.package_id = ?
        AND p.organization_id = ?
    `).get(
      packageId,
      organizationId
    ) as Row | undefined;

    return row
      ? listingFromRow(row)
      : undefined;
  }

  getPublicListing(
    packageId: string
  ): MarketplaceListing | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM marketplace_listings
      WHERE package_id = ?
        AND status = 'published'
        AND visibility IN (
          'public',
          'unlisted'
        )
    `).get(packageId) as Row | undefined;

    return row
      ? listingFromRow(row)
      : undefined;
  }

  searchPublicListings(
    input: MarketplaceSearchRequest
  ): MarketplaceSearchResponse {
    const q =
      input.q?.trim().toLowerCase();
    const type = input.type;
    const publisherId =
      input.publisherId?.trim();

    const rows = this.db.prepare(`
      SELECT *
      FROM marketplace_listings
      WHERE status = 'published'
        AND visibility = 'public'
        AND (
          ? IS NULL OR package_type = ?
        )
        AND (
          ? IS NULL OR publisher_id = ?
        )
      ORDER BY
        updated_at DESC,
        package_id ASC
    `).all(
      type ?? null,
      type ?? null,
      publisherId || null,
      publisherId || null
    ) as Row[];

    const filtered = rows
      .map(listingFromRow)
      .filter((listing) => {
        if (q) {
          const searchable = [
            listing.packageId,
            listing.displayName,
            listing.summary,
            ...(listing.tags ?? []),
            ...(listing.categories ?? [])
          ]
            .join(" ")
            .toLowerCase();

          if (!searchable.includes(q)) {
            return false;
          }
        }

        if (
          input.pricingModel &&
          !listing.pricing.some(
            (plan) =>
              plan.model ===
                input.pricingModel
          )
        ) {
          return false;
        }

        if (
          input.tags?.length &&
          !input.tags.every((tag) =>
            (listing.tags ?? [])
              .includes(tag)
          )
        ) {
          return false;
        }

        if (
          input.categories?.length &&
          !input.categories.every(
            (category) =>
              (listing.categories ?? [])
                .includes(category)
          )
        ) {
          return false;
        }

        return true;
      });

    const limit = clampLimit(input.limit);
    const offset = decodeCursor(
      input.cursor
    );
    const items = filtered.slice(
      offset,
      offset + limit
    );
    const nextOffset =
      offset + items.length;

    return {
      items,
      nextCursor:
        nextOffset < filtered.length
          ? encodeCursor(nextOffset)
          : undefined
    };
  }

  addArtifact(
    organizationId: string,
    artifact: MarketplaceArtifact
  ): MarketplaceArtifact {
    this.requireManagedListing(
      organizationId,
      artifact.packageId
    );

    this.db.prepare(`
      INSERT INTO marketplace_versions (
        package_id,
        version,
        download_url,
        sha256,
        signature,
        provenance_url,
        manifest_json,
        changelog,
        published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(package_id, version)
      DO UPDATE SET
        download_url = excluded.download_url,
        sha256 = excluded.sha256,
        signature = excluded.signature,
        provenance_url = excluded.provenance_url,
        manifest_json = excluded.manifest_json,
        changelog = excluded.changelog,
        published_at = excluded.published_at
    `).run(
      artifact.packageId,
      artifact.version,
      artifact.downloadUrl,
      artifact.sha256,
      artifact.signature ?? null,
      artifact.provenanceUrl ?? null,
      JSON.stringify(artifact.manifest),
      artifact.changelog ?? null,
      artifact.publishedAt
    );

    return this.requireManagedArtifact(
      organizationId,
      artifact.packageId,
      artifact.version
    );
  }

  listManagedArtifacts(
    organizationId: string,
    packageId: string
  ): MarketplaceArtifact[] {
    this.requireManagedListing(
      organizationId,
      packageId
    );

    return this.artifactRows(
      packageId
    ).map(artifactFromRow);
  }

  getManagedArtifact(
    organizationId: string,
    packageId: string,
    version: string
  ): MarketplaceArtifact | undefined {
    if (
      !this.getManagedListing(
        organizationId,
        packageId
      )
    ) {
      return undefined;
    }

    const row = this.artifactRow(
      packageId,
      version
    );

    return row
      ? artifactFromRow(row)
      : undefined;
  }

  listPublicArtifacts(
    packageId: string
  ): MarketplaceArtifact[] {
    if (!this.getPublicListing(packageId)) {
      return [];
    }

    return this.artifactRows(
      packageId
    ).map(artifactFromRow);
  }

  getPublicArtifact(
    packageId: string,
    version: string
  ): MarketplaceArtifact | undefined {
    if (!this.getPublicListing(packageId)) {
      return undefined;
    }

    const row = this.artifactRow(
      packageId,
      version
    );

    return row
      ? artifactFromRow(row)
      : undefined;
  }

  publishListing(
    organizationId: string,
    packageId: string
  ): MarketplaceListing {
    const listing =
      this.requireManagedListing(
        organizationId,
        packageId
      );

    if (
      !this.getManagedArtifact(
        organizationId,
        packageId,
        listing.latestVersion
      )
    ) {
      throw new Error(
        `Latest version artifact is missing: ${listing.latestVersion}`
      );
    }

    this.db.prepare(`
      UPDATE marketplace_listings
      SET status = 'published',
          updated_at = ?
      WHERE package_id = ?
    `).run(
      new Date().toISOString(),
      packageId
    );

    return this.requireManagedListing(
      organizationId,
      packageId
    );
  }

  unpublishListing(
    organizationId: string,
    packageId: string
  ): MarketplaceListing {
    this.requireManagedListing(
      organizationId,
      packageId
    );

    this.db.prepare(`
      UPDATE marketplace_listings
      SET status = 'draft',
          updated_at = ?
      WHERE package_id = ?
    `).run(
      new Date().toISOString(),
      packageId
    );

    return this.requireManagedListing(
      organizationId,
      packageId
    );
  }

  private requireManagedPublisher(
    organizationId: string,
    publisherId: string
  ): MarketplacePublisherProfile {
    const publisher =
      this.getManagedPublisher(
        organizationId,
        publisherId
      );

    if (!publisher) {
      throw new Error(
        `Publisher not found for organization: ${publisherId}`
      );
    }

    return publisher;
  }

  private requireManagedListing(
    organizationId: string,
    packageId: string
  ): MarketplaceListing {
    const listing = this.getManagedListing(
      organizationId,
      packageId
    );

    if (!listing) {
      throw new Error(
        `Listing not found for organization: ${packageId}`
      );
    }

    return listing;
  }

  private requireManagedArtifact(
    organizationId: string,
    packageId: string,
    version: string
  ): MarketplaceArtifact {
    const artifact = this.getManagedArtifact(
      organizationId,
      packageId,
      version
    );

    if (!artifact) {
      throw new Error(
        `Artifact not found: ${packageId}@${version}`
      );
    }

    return artifact;
  }

  private publisherRow(
    publisherId: string
  ): Row | undefined {
    return this.db.prepare(`
      SELECT *
      FROM marketplace_publishers
      WHERE id = ?
    `).get(publisherId) as
      | Row
      | undefined;
  }

  private listingRow(
    packageId: string
  ): Row | undefined {
    return this.db.prepare(`
      SELECT *
      FROM marketplace_listings
      WHERE package_id = ?
    `).get(packageId) as
      | Row
      | undefined;
  }

  private artifactRows(
    packageId: string
  ): Row[] {
    return this.db.prepare(`
      SELECT *
      FROM marketplace_versions
      WHERE package_id = ?
      ORDER BY
        published_at DESC,
        version DESC
    `).all(packageId) as Row[];
  }

  private artifactRow(
    packageId: string,
    version: string
  ): Row | undefined {
    return this.db.prepare(`
      SELECT *
      FROM marketplace_versions
      WHERE package_id = ?
        AND version = ?
    `).get(
      packageId,
      version
    ) as Row | undefined;
  }
}

function publisherFromRow(
  row: Row
): MarketplacePublisherProfile {
  return {
    id: String(row.id),
    displayName:
      String(row.display_name),
    description:
      optionalString(row.description),
    website:
      optionalString(row.website),
    supportUrl:
      optionalString(row.support_url),
    privacyUrl:
      optionalString(row.privacy_url),
    termsUrl:
      optionalString(row.terms_url),
    verified: Boolean(row.verified),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function listingFromRow(
  row: Row
): MarketplaceListing {
  return {
    id: String(row.listing_id),
    packageId: String(row.package_id),
    packageType: row.package_type,
    slug: String(row.slug),
    displayName:
      String(row.display_name),
    summary: String(row.summary),
    publisherId:
      String(row.publisher_id),
    latestVersion:
      String(row.latest_version),
    tags:
      parseJson(row.tags_json, []),
    categories:
      parseJson(row.categories_json, []),
    pricing:
      parseJson(row.pricing_json, []),
    license:
      row.license_json
        ? parseJson(
            row.license_json,
            undefined
          )
        : undefined,
    visibility: row.visibility,
    status: row.status,
    verified: Boolean(row.verified),
    installCount:
      Number(row.install_count ?? 0),
    rating: {
      average:
        Number(
          row.rating_average ?? 0
        ),
      count:
        Number(row.rating_count ?? 0)
    },
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function artifactFromRow(
  row: Row
): MarketplaceArtifact {
  return {
    packageId: String(row.package_id),
    version: String(row.version),
    downloadUrl:
      String(row.download_url),
    sha256: String(row.sha256),
    signature:
      optionalString(row.signature),
    provenanceUrl:
      optionalString(
        row.provenance_url
      ),
    manifest:
      parseRequiredJson<
        MarketplaceArtifact["manifest"]
      >(row.manifest_json),
    changelog:
      optionalString(row.changelog),
    publishedAt:
      String(row.published_at)
  };
}

function parseJson<T>(
  value: unknown,
  fallback: T
): T {
  try {
    return typeof value === "string"
      ? JSON.parse(value) as T
      : fallback;
  } catch {
    return fallback;
  }
}

function parseRequiredJson<T>(
  value: unknown
): T {
  if (typeof value !== "string") {
    throw new Error(
      "Marketplace registry contains invalid JSON data"
    );
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(
      "Marketplace registry contains invalid JSON data"
    );
  }
}

function optionalString(
  value: unknown
): string | undefined {
  return typeof value === "string" &&
    value.length > 0
    ? value
    : undefined;
}

function clampLimit(
  value: number | undefined
): number {
  if (!Number.isInteger(value)) {
    return 20;
  }

  return Math.max(
    1,
    Math.min(value ?? 20, 100)
  );
}

function encodeCursor(
  offset: number
): string {
  return Buffer
    .from(String(offset))
    .toString("base64url");
}

function decodeCursor(
  cursor: string | undefined
): number {
  if (!cursor) {
    return 0;
  }

  try {
    const decoded = Number(
      Buffer
        .from(cursor, "base64url")
        .toString("utf8")
    );

    return Number.isInteger(decoded) &&
      decoded >= 0
      ? decoded
      : 0;
  } catch {
    return 0;
  }
}
