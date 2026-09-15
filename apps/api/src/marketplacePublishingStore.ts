import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  validateMarketplaceListing,
  type MarketplaceArtifact,
  type MarketplaceListing,
  type MarketplacePublisherProfile
} from "@oeap/package-spec";

export type MarketplaceSubmissionStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected";

export type MarketplacePublisherStatus =
  | "active"
  | "suspended";

export interface MarketplacePublisherAccount {
  publisherId: string;
  organizationId: string;
  displayName: string;
  description?: string;
  website?: string;
  supportUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
  verified: boolean;
  status: MarketplacePublisherStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceSubmission {
  id: string;
  organizationId: string;
  publisherId: string;
  packageId: string;
  status: MarketplaceSubmissionStatus;
  listing: MarketplaceListing;
  artifact?: MarketplaceArtifact;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  reviewedAt?: string;
}

export interface ApprovedMarketplaceEntry {
  publisher: MarketplacePublisherProfile;
  listing: MarketplaceListing;
  artifact?: MarketplaceArtifact;
}

export class MarketplacePublishingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplacePublishingValidationError";
  }
}

export class MarketplacePublishingStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.createSchema();
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_publishers (
        publisher_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT,
        website TEXT,
        support_url TEXT,
        privacy_url TEXT,
        terms_url TEXT,
        verified INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS marketplace_submissions (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        publisher_id TEXT NOT NULL,
        package_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        listing_json TEXT NOT NULL,
        artifact_json TEXT,
        review_note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        submitted_at TEXT,
        reviewed_at TEXT,
        FOREIGN KEY (publisher_id)
          REFERENCES marketplace_publishers(publisher_id)
      );

      CREATE INDEX IF NOT EXISTS idx_marketplace_submissions_org
        ON marketplace_submissions (organization_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_marketplace_submissions_status
        ON marketplace_submissions (status, submitted_at);
    `);
  }

  getPublisherForOrganization(
    organizationId: string
  ): MarketplacePublisherAccount | null {
    const row = this.db.prepare(`
      SELECT *
      FROM marketplace_publishers
      WHERE organization_id = ?
    `).get(organizationId) as any;

    return row ? this.mapPublisher(row) : null;
  }

  getPublisher(
    publisherId: string
  ): MarketplacePublisherAccount | null {
    const row = this.db.prepare(`
      SELECT *
      FROM marketplace_publishers
      WHERE publisher_id = ?
    `).get(publisherId) as any;

    return row ? this.mapPublisher(row) : null;
  }

  upsertPublisher(input: {
    organizationId: string;
    publisherId: string;
    displayName: string;
    description?: string;
    website?: string;
    supportUrl?: string;
    privacyUrl?: string;
    termsUrl?: string;
  }): MarketplacePublisherAccount {
    const publisherId = normalizePublisherId(input.publisherId);
    const displayName = input.displayName?.trim();

    if (!displayName) {
      throw new MarketplacePublishingValidationError(
        "Publisher displayName is required"
      );
    }

    if (["oeap", "oeap-official"].includes(publisherId)) {
      throw new MarketplacePublishingValidationError(
        "Publisher ID is reserved"
      );
    }

    const byId = this.getPublisher(publisherId);
    if (
      byId &&
      byId.organizationId !== input.organizationId
    ) {
      throw new MarketplacePublishingValidationError(
        "Publisher ID is already owned by another organization"
      );
    }

    const byOrganization = this.getPublisherForOrganization(
      input.organizationId
    );
    if (
      byOrganization &&
      byOrganization.publisherId !== publisherId
    ) {
      throw new MarketplacePublishingValidationError(
        "An organization may own only one Marketplace publisher profile in V1"
      );
    }

    const now = new Date().toISOString();
    const createdAt = byId?.createdAt ?? now;

    this.db.prepare(`
      INSERT INTO marketplace_publishers (
        publisher_id,
        organization_id,
        display_name,
        description,
        website,
        support_url,
        privacy_url,
        terms_url,
        verified,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(publisher_id) DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        website = excluded.website,
        support_url = excluded.support_url,
        privacy_url = excluded.privacy_url,
        terms_url = excluded.terms_url,
        updated_at = excluded.updated_at
    `).run(
      publisherId,
      input.organizationId,
      displayName,
      clean(input.description),
      clean(input.website),
      clean(input.supportUrl),
      clean(input.privacyUrl),
      clean(input.termsUrl),
      byId?.verified ? 1 : 0,
      byId?.status ?? "active",
      createdAt,
      now
    );

    return this.requirePublisher(publisherId);
  }

  saveDraft(input: {
    organizationId: string;
    publisherId: string;
    listing: MarketplaceListing;
    artifact?: MarketplaceArtifact;
  }): MarketplaceSubmission {
    const publisher = this.requireOwnedPublisher(
      input.organizationId,
      input.publisherId
    );

    if (publisher.status !== "active") {
      throw new MarketplacePublishingValidationError(
        "Publisher account is suspended"
      );
    }

    if (input.listing.publisherId !== publisher.publisherId) {
      throw new MarketplacePublishingValidationError(
        "Listing publisherId does not match the organization publisher"
      );
    }

    if (
      input.listing.status !== "draft" ||
      input.listing.visibility !== "public"
    ) {
      throw new MarketplacePublishingValidationError(
        "Publisher listings must be public draft listings before review"
      );
    }

    const validation =
      validateMarketplaceListing(input.listing);
    if (!validation.valid) {
      throw new MarketplacePublishingValidationError(
        `Invalid Marketplace listing: ${validation.errors.join("; ")}`
      );
    }

    if (input.artifact) {
      validateArtifactAgainstListing(
        input.artifact,
        input.listing
      );
    }

    const existing = this.getSubmission(
      input.listing.packageId
    );

    if (
      existing &&
      existing.organizationId !== input.organizationId
    ) {
      throw new MarketplacePublishingValidationError(
        "Package ID is already owned by another organization"
      );
    }

    if (existing?.status === "submitted") {
      throw new MarketplacePublishingValidationError(
        "Submitted listings cannot be edited until review is complete"
      );
    }

    if (existing?.status === "approved") {
      throw new MarketplacePublishingValidationError(
        "Approved listings are immutable in Marketplace V1; version-update submissions are a later lifecycle"
      );
    }

    const now = new Date().toISOString();
    const id =
      existing?.id ?? `submission_${randomUUID()}`;

    this.db.prepare(`
      INSERT INTO marketplace_submissions (
        id,
        organization_id,
        publisher_id,
        package_id,
        status,
        listing_json,
        artifact_json,
        review_note,
        created_at,
        updated_at,
        submitted_at,
        reviewed_at
      ) VALUES (?, ?, ?, ?, 'draft', ?, ?, NULL, ?, ?, NULL, NULL)
      ON CONFLICT(package_id) DO UPDATE SET
        status = 'draft',
        listing_json = excluded.listing_json,
        artifact_json = excluded.artifact_json,
        review_note = NULL,
        updated_at = excluded.updated_at,
        submitted_at = NULL,
        reviewed_at = NULL
    `).run(
      id,
      input.organizationId,
      publisher.publisherId,
      input.listing.packageId,
      JSON.stringify(input.listing),
      input.artifact
        ? JSON.stringify(input.artifact)
        : null,
      existing?.createdAt ?? now,
      now
    );

    return this.requireSubmission(
      input.listing.packageId
    );
  }

  submit(
    organizationId: string,
    packageId: string
  ): MarketplaceSubmission {
    const submission = this.requireOwnedSubmission(
      organizationId,
      packageId
    );

    if (submission.status !== "draft") {
      throw new MarketplacePublishingValidationError(
        "Only draft listings may be submitted for review"
      );
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE marketplace_submissions
      SET
        status = 'submitted',
        submitted_at = ?,
        updated_at = ?,
        review_note = NULL,
        reviewed_at = NULL
      WHERE package_id = ?
    `).run(now, now, packageId);

    return this.requireSubmission(packageId);
  }

  review(input: {
    packageId: string;
    decision: "approve" | "reject";
    note?: string;
    verifyPublisher?: boolean;
  }): {
    submission: MarketplaceSubmission;
    publisher: MarketplacePublisherProfile;
  } {
    const submission = this.requireSubmission(input.packageId);

    if (submission.status !== "submitted") {
      throw new MarketplacePublishingValidationError(
        "Only submitted listings may be reviewed"
      );
    }

    const now = new Date().toISOString();
    const publisher = this.requirePublisher(
      submission.publisherId
    );

    if (input.decision === "approve") {
      const listing: MarketplaceListing = {
        ...submission.listing,
        status: "published",
        visibility: "public",
        verified:
          Boolean(input.verifyPublisher) || publisher.verified,
        updatedAt: now
      };

      this.db.prepare(`
        UPDATE marketplace_submissions
        SET
          status = 'approved',
          listing_json = ?,
          review_note = ?,
          reviewed_at = ?,
          updated_at = ?
        WHERE package_id = ?
      `).run(
        JSON.stringify(listing),
        clean(input.note),
        now,
        now,
        input.packageId
      );

      if (input.verifyPublisher && !publisher.verified) {
        this.db.prepare(`
          UPDATE marketplace_publishers
          SET verified = 1, updated_at = ?
          WHERE publisher_id = ?
        `).run(now, publisher.publisherId);
      }
    } else {
      this.db.prepare(`
        UPDATE marketplace_submissions
        SET
          status = 'rejected',
          review_note = ?,
          reviewed_at = ?,
          updated_at = ?
        WHERE package_id = ?
      `).run(
        clean(input.note) || "Marketplace review rejected",
        now,
        now,
        input.packageId
      );
    }

    const reviewed = this.requireSubmission(input.packageId);
    return {
      submission: reviewed,
      publisher: this.toPublicPublisher(
        this.requirePublisher(reviewed.publisherId)
      )
    };
  }

  getSubmission(
    packageId: string
  ): MarketplaceSubmission | null {
    const row = this.db.prepare(`
      SELECT *
      FROM marketplace_submissions
      WHERE package_id = ?
    `).get(packageId) as any;

    return row ? this.mapSubmission(row) : null;
  }

  listForOrganization(
    organizationId: string
  ): MarketplaceSubmission[] {
    return (this.db.prepare(`
      SELECT *
      FROM marketplace_submissions
      WHERE organization_id = ?
      ORDER BY updated_at DESC
    `).all(organizationId) as any[])
      .map((row) => this.mapSubmission(row));
  }

  listReviewQueue(): MarketplaceSubmission[] {
    return (this.db.prepare(`
      SELECT *
      FROM marketplace_submissions
      WHERE status = 'submitted'
      ORDER BY submitted_at ASC, created_at ASC
    `).all() as any[])
      .map((row) => this.mapSubmission(row));
  }

  listApprovedEntries(): ApprovedMarketplaceEntry[] {
    const rows = this.db.prepare(`
      SELECT
        s.*,
        p.display_name,
        p.description AS publisher_description,
        p.website,
        p.support_url,
        p.privacy_url,
        p.terms_url,
        p.verified,
        p.created_at AS publisher_created_at,
        p.updated_at AS publisher_updated_at
      FROM marketplace_submissions s
      INNER JOIN marketplace_publishers p
        ON p.publisher_id = s.publisher_id
      WHERE s.status = 'approved'
        AND p.status = 'active'
      ORDER BY s.updated_at ASC
    `).all() as any[];

    return rows.map((row) => ({
      publisher: {
        id: String(row.publisher_id),
        displayName: String(row.display_name),
        description: optional(row.publisher_description),
        website: optional(row.website),
        supportUrl: optional(row.support_url),
        privacyUrl: optional(row.privacy_url),
        termsUrl: optional(row.terms_url),
        verified: Boolean(row.verified),
        createdAt: String(row.publisher_created_at),
        updatedAt: String(row.publisher_updated_at)
      },
      listing: JSON.parse(String(row.listing_json)),
      ...(row.artifact_json
        ? { artifact: JSON.parse(String(row.artifact_json)) }
        : {})
    }));
  }

  private requirePublisher(
    publisherId: string
  ): MarketplacePublisherAccount {
    const publisher = this.getPublisher(publisherId);
    if (!publisher) {
      throw new MarketplacePublishingValidationError(
        "Marketplace publisher not found"
      );
    }
    return publisher;
  }

  private requireOwnedPublisher(
    organizationId: string,
    publisherId: string
  ): MarketplacePublisherAccount {
    const publisher = this.requirePublisher(publisherId);
    if (publisher.organizationId !== organizationId) {
      throw new MarketplacePublishingValidationError(
        "Marketplace publisher belongs to another organization"
      );
    }
    return publisher;
  }

  private requireSubmission(
    packageId: string
  ): MarketplaceSubmission {
    const submission = this.getSubmission(packageId);
    if (!submission) {
      throw new MarketplacePublishingValidationError(
        "Marketplace submission not found"
      );
    }
    return submission;
  }

  private requireOwnedSubmission(
    organizationId: string,
    packageId: string
  ): MarketplaceSubmission {
    const submission = this.requireSubmission(packageId);
    if (submission.organizationId !== organizationId) {
      throw new MarketplacePublishingValidationError(
        "Marketplace submission belongs to another organization"
      );
    }
    return submission;
  }

  private mapPublisher(row: any): MarketplacePublisherAccount {
    return {
      publisherId: String(row.publisher_id),
      organizationId: String(row.organization_id),
      displayName: String(row.display_name),
      description: optional(row.description),
      website: optional(row.website),
      supportUrl: optional(row.support_url),
      privacyUrl: optional(row.privacy_url),
      termsUrl: optional(row.terms_url),
      verified: Boolean(row.verified),
      status:
        row.status === "suspended" ? "suspended" : "active",
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapSubmission(row: any): MarketplaceSubmission {
    const status = String(row.status) as MarketplaceSubmissionStatus;
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      publisherId: String(row.publisher_id),
      packageId: String(row.package_id),
      status,
      listing: JSON.parse(String(row.listing_json)),
      ...(row.artifact_json
        ? { artifact: JSON.parse(String(row.artifact_json)) }
        : {}),
      reviewNote: optional(row.review_note),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      submittedAt: optional(row.submitted_at),
      reviewedAt: optional(row.reviewed_at)
    };
  }

  private toPublicPublisher(
    publisher: MarketplacePublisherAccount
  ): MarketplacePublisherProfile {
    return {
      id: publisher.publisherId,
      displayName: publisher.displayName,
      description: publisher.description,
      website: publisher.website,
      supportUrl: publisher.supportUrl,
      privacyUrl: publisher.privacyUrl,
      termsUrl: publisher.termsUrl,
      verified: publisher.verified,
      createdAt: publisher.createdAt,
      updatedAt: publisher.updatedAt
    };
  }
}

function normalizePublisherId(value: string): string {
  const normalized = value?.trim().toLowerCase();
  if (
    !normalized ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ||
    normalized.length < 3 ||
    normalized.length > 50
  ) {
    throw new MarketplacePublishingValidationError(
      "publisherId must be 3-50 lowercase letters/digits with single hyphen-separated segments"
    );
  }
  return normalized;
}

export function normalizePackageSlug(value: string): string {
  const normalized = value?.trim().toLowerCase();
  if (
    !normalized ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ||
    normalized.length > 80
  ) {
    throw new MarketplacePublishingValidationError(
      "Package slug must contain lowercase letters/digits with single hyphen-separated segments"
    );
  }
  return normalized;
}

function validateArtifactAgainstListing(
  artifact: MarketplaceArtifact,
  listing: MarketplaceListing
): void {
  if (
    artifact.packageId !== listing.packageId ||
    artifact.version !== listing.latestVersion ||
    artifact.manifest?.id !== listing.packageId ||
    artifact.manifest?.version !== listing.latestVersion ||
    artifact.manifest?.type !== listing.packageType
  ) {
    throw new MarketplacePublishingValidationError(
      "Artifact package/version/type must match the listing"
    );
  }

  if (!/^[a-f0-9]{64}$/i.test(artifact.sha256 || "")) {
    throw new MarketplacePublishingValidationError(
      "Artifact sha256 must be a 64-character hexadecimal digest"
    );
  }

  if (!httpUrl(artifact.downloadUrl)) {
    throw new MarketplacePublishingValidationError(
      "Artifact downloadUrl must use http or https"
    );
  }
}

function httpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function clean(value: string | undefined): string | null {
  const result = value?.trim();
  return result || null;
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}
