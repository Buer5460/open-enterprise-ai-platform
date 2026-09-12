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

type VaultDocument = {
  version: 1;
  organizations: Record<string, Record<string, {
    values: Record<string, string>;
    updatedAt: string;
  }>>;
};

type EncryptedDocument = {
  version: 1;
  iv: string;
  tag: string;
  data: string;
};

export type PublicConnectorCredential = {
  connectorId: string;
  keys: string[];
  updatedAt: string;
};

export class ConnectorSecretStore {
  constructor(
    private readonly dataPath: string,
    private readonly keyPath: string
  ) {
    mkdirSync(dirname(dataPath), { recursive: true });
    mkdirSync(dirname(keyPath), { recursive: true });
    this.ensureKey();
  }

  list(organizationId: string): PublicConnectorCredential[] {
    const entries = this.readDocument().organizations[organizationId] ?? {};
    return Object.entries(entries)
      .map(([connectorId, item]) => ({
        connectorId,
        keys: Object.keys(item.values).sort(),
        updatedAt: item.updatedAt
      }))
      .sort((a, b) => a.connectorId.localeCompare(b.connectorId));
  }

  publicView(organizationId: string, connectorId: string): PublicConnectorCredential {
    const item = this.readDocument().organizations[organizationId]?.[connectorId];
    return {
      connectorId,
      keys: item ? Object.keys(item.values).sort() : [],
      updatedAt: item?.updatedAt ?? ""
    };
  }

  get(organizationId: string, connectorId: string): Record<string, string> {
    return {
      ...(this.readDocument().organizations[organizationId]?.[connectorId]?.values ?? {})
    };
  }

  update(
    organizationId: string,
    connectorId: string,
    patch: Record<string, string | undefined>,
    clear: string[] = []
  ): PublicConnectorCredential {
    const document = this.readDocument();
    const organizations = document.organizations;
    const organization = organizations[organizationId] ?? {};
    const current = organization[connectorId]?.values ?? {};
    const next = { ...current };

    for (const [key, value] of Object.entries(patch)) {
      const safeKey = normalizeKey(key);
      if (!safeKey) continue;
      if (typeof value === "string" && value.length > 0) {
        if (value.length > 20_000) throw new Error(`Credential ${safeKey} is too large`);
        next[safeKey] = value;
      }
    }

    for (const key of clear) {
      delete next[normalizeKey(key)];
    }

    const updatedAt = new Date().toISOString();
    organization[connectorId] = { values: next, updatedAt };
    organizations[organizationId] = organization;
    this.writeDocument(document);

    return {
      connectorId,
      keys: Object.keys(next).sort(),
      updatedAt
    };
  }

  delete(organizationId: string, connectorId: string): boolean {
    const document = this.readDocument();
    const organization = document.organizations[organizationId];
    if (!organization?.[connectorId]) return false;
    delete organization[connectorId];
    this.writeDocument(document);
    return true;
  }

  private ensureKey() {
    if (!existsSync(this.keyPath)) {
      writeFileSync(this.keyPath, randomBytes(32), { mode: 0o600 });
    }
  }

  private readKey(): Buffer {
    const key = readFileSync(this.keyPath);
    if (key.length !== 32) throw new Error("OEAP connector vault key is invalid");
    return key;
  }

  private readDocument(): VaultDocument {
    if (!existsSync(this.dataPath)) {
      return { version: 1, organizations: {} };
    }

    const encrypted = JSON.parse(readFileSync(this.dataPath, "utf8")) as EncryptedDocument;
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
    return JSON.parse(plaintext) as VaultDocument;
  }

  private writeDocument(document: VaultDocument) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.readKey(), iv);
    const plaintext = Buffer.from(JSON.stringify(document), "utf8");
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const output: EncryptedDocument = {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64")
    };
    writeFileSync(this.dataPath, JSON.stringify(output), { mode: 0o600 });
  }
}

function normalizeKey(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
}
