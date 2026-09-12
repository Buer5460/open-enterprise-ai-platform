import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";

export interface OrganizationBrandSettings {
  organizationName?: string;
  shortName?: string;
  logoUrl?: string;
  primaryColor?: string;
  loginTitle?: string;
  loginSubtitle?: string;
  emailSignature?: string;
  invitationSubject?: string;
  invitationFooter?: string;
  updatedAt?: string;
}

type BrandSettingsDocument = {
  version: 1;
  organizations: Record<string, OrganizationBrandSettings>;
};

type EncryptedDocument = {
  version: 1;
  iv: string;
  tag: string;
  data: string;
};

export class BrandSettingsStore {
  constructor(
    private readonly dataPath: string,
    private readonly keyPath: string
  ) {
    mkdirSync(dirname(dataPath), { recursive: true });
    mkdirSync(dirname(keyPath), { recursive: true });
    this.ensureKey();
  }

  get(organizationId: string): OrganizationBrandSettings {
    const document = this.readDocument();
    return {
      ...(document.organizations[organizationId] ?? {})
    };
  }

  update(
    organizationId: string,
    patch: Partial<OrganizationBrandSettings>
  ): OrganizationBrandSettings {
    const document = this.readDocument();
    const current = this.get(organizationId);

    const next: OrganizationBrandSettings = {
      ...current,
      ...stripUndefined(patch),
      updatedAt: new Date().toISOString()
    };

    if (next.primaryColor) {
      const normalized = normalizeColor(next.primaryColor);
      if (!normalized) {
        throw new Error("primaryColor must be a valid #RRGGBB value");
      }
      next.primaryColor = normalized;
    }

    document.organizations[organizationId] = next;
    this.writeDocument(document);
    return next;
  }

  private ensureKey(): void {
    if (existsSync(this.keyPath)) return;
    writeFileSync(this.keyPath, randomBytes(32), { mode: 0o600 });
  }

  private readKey(): Buffer {
    const key = readFileSync(this.keyPath);
    if (key.length !== 32) {
      throw new Error("OEAP brand settings encryption key is invalid");
    }
    return key;
  }

  private readDocument(): BrandSettingsDocument {
    if (!existsSync(this.dataPath)) {
      return { version: 1, organizations: {} };
    }

    const encrypted = JSON.parse(
      readFileSync(this.dataPath, "utf8")
    ) as EncryptedDocument;

    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.readKey(),
      Buffer.from(encrypted.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.data, "base64")),
      decipher.final()
    ]).toString("utf8");

    return JSON.parse(plaintext) as BrandSettingsDocument;
  }

  private writeDocument(document: BrandSettingsDocument): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.readKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(document), "utf8"),
      cipher.final()
    ]);

    const encrypted: EncryptedDocument = {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: ciphertext.toString("base64")
    };

    writeFileSync(
      this.dataPath,
      JSON.stringify(encrypted, null, 2),
      { mode: 0o600 }
    );
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as Partial<T>;
}

function normalizeColor(value: string): string | undefined {
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed)
    ? trimmed.toUpperCase()
    : undefined;
}
