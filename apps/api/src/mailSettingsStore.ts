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

import type {
  MailProviderId,
  MailRuntimeConfig
} from "./mailDelivery.js";

export interface StoredMailSettings
  extends MailRuntimeConfig {
  updatedAt?: string;
}

export interface PublicMailSettings {
  provider: MailProviderId;
  from?: string;
  webhookUrl?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpStartTls?: boolean;
  smtpRejectUnauthorized?: boolean;
  smtpUser?: string;
  smtpFrom?: string;
  smtpHelo?: string;
  hasResendApiKey: boolean;
  hasWebhookToken: boolean;
  hasSmtpPassword: boolean;
  updatedAt?: string;
}

type MailSettingsDocument = {
  version: 1;
  organizations: Record<
    string,
    StoredMailSettings
  >;
};

type EncryptedDocument = {
  version: 1;
  iv: string;
  tag: string;
  data: string;
};

const DEFAULT_SETTINGS: StoredMailSettings = {
  provider: "manual",
  smtpPort: 587,
  smtpSecure: false,
  smtpStartTls: true,
  smtpRejectUnauthorized: true
};

export class MailSettingsStore {
  constructor(
    private readonly dataPath: string,
    private readonly keyPath: string
  ) {
    mkdirSync(dirname(dataPath), {
      recursive: true
    });
    mkdirSync(dirname(keyPath), {
      recursive: true
    });
    this.ensureKey();
  }

  get(
    organizationId: string
  ): StoredMailSettings {
    const document = this.readDocument();
    return {
      ...DEFAULT_SETTINGS,
      ...(document.organizations[
        organizationId
      ] ?? {})
    };
  }

  publicView(
    organizationId: string
  ): PublicMailSettings {
    const settings = this.get(organizationId);

    return {
      provider: settings.provider,
      from: settings.from,
      webhookUrl: settings.webhookUrl,
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort,
      smtpSecure: settings.smtpSecure,
      smtpStartTls: settings.smtpStartTls,
      smtpRejectUnauthorized:
        settings.smtpRejectUnauthorized,
      smtpUser: settings.smtpUser,
      smtpFrom: settings.smtpFrom,
      smtpHelo: settings.smtpHelo,
      hasResendApiKey:
        Boolean(settings.resendApiKey),
      hasWebhookToken:
        Boolean(settings.webhookToken),
      hasSmtpPassword:
        Boolean(settings.smtpPassword),
      updatedAt: settings.updatedAt
    };
  }

  update(
    organizationId: string,
    patch: Partial<StoredMailSettings> & {
      clearResendApiKey?: boolean;
      clearWebhookToken?: boolean;
      clearSmtpPassword?: boolean;
    }
  ): StoredMailSettings {
    const document = this.readDocument();
    const current = this.get(organizationId);

    const next: StoredMailSettings = {
      ...current,
      ...stripUndefined(patch),
      updatedAt: new Date().toISOString()
    };

    if (!patch.resendApiKey) {
      next.resendApiKey = current.resendApiKey;
    }
    if (!patch.webhookToken) {
      next.webhookToken = current.webhookToken;
    }
    if (!patch.smtpPassword) {
      next.smtpPassword = current.smtpPassword;
    }

    if (patch.clearResendApiKey) {
      delete next.resendApiKey;
    }
    if (patch.clearWebhookToken) {
      delete next.webhookToken;
    }
    if (patch.clearSmtpPassword) {
      delete next.smtpPassword;
    }

    delete (next as any).clearResendApiKey;
    delete (next as any).clearWebhookToken;
    delete (next as any).clearSmtpPassword;

    validateSettings(next);

    document.organizations[
      organizationId
    ] = next;
    this.writeDocument(document);

    return next;
  }

  private ensureKey(): void {
    if (existsSync(this.keyPath)) {
      return;
    }

    writeFileSync(
      this.keyPath,
      randomBytes(32),
      { mode: 0o600 }
    );
  }

  private readKey(): Buffer {
    const key = readFileSync(this.keyPath);

    if (key.length !== 32) {
      throw new Error(
        "OEAP mail settings encryption key is invalid"
      );
    }

    return key;
  }

  private readDocument(): MailSettingsDocument {
    if (!existsSync(this.dataPath)) {
      return {
        version: 1,
        organizations: {}
      };
    }

    const encrypted = JSON.parse(
      readFileSync(this.dataPath, "utf8")
    ) as EncryptedDocument;

    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.readKey(),
      Buffer.from(encrypted.iv, "base64")
    );
    decipher.setAuthTag(
      Buffer.from(encrypted.tag, "base64")
    );

    const plaintext = Buffer.concat([
      decipher.update(
        Buffer.from(
          encrypted.data,
          "base64"
        )
      ),
      decipher.final()
    ]).toString("utf8");

    return JSON.parse(
      plaintext
    ) as MailSettingsDocument;
  }

  private writeDocument(
    document: MailSettingsDocument
  ): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.readKey(),
      iv
    );
    const encrypted = Buffer.concat([
      cipher.update(
        JSON.stringify(document),
        "utf8"
      ),
      cipher.final()
    ]);

    const payload: EncryptedDocument = {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher
        .getAuthTag()
        .toString("base64"),
      data: encrypted.toString("base64")
    };

    writeFileSync(
      this.dataPath,
      JSON.stringify(payload, null, 2),
      { mode: 0o600 }
    );
  }
}

function stripUndefined<T extends object>(
  value: T
): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== undefined
    )
  ) as Partial<T>;
}

function validateSettings(
  settings: StoredMailSettings
): void {
  if (
    ![
      "manual",
      "resend",
      "webhook",
      "smtp"
    ].includes(settings.provider)
  ) {
    throw new Error("Unsupported mail provider");
  }

  if (
    settings.provider === "resend" &&
    (!settings.resendApiKey || !settings.from)
  ) {
    throw new Error(
      "Resend requires API key and sender address"
    );
  }

  if (
    settings.provider === "webhook" &&
    !settings.webhookUrl
  ) {
    throw new Error(
      "Webhook provider requires a URL"
    );
  }

  if (
    settings.provider === "smtp" &&
    (!settings.smtpHost || !settings.smtpFrom)
  ) {
    throw new Error(
      "SMTP requires host and sender address"
    );
  }
}
