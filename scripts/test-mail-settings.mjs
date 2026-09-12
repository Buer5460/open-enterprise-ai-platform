import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MailSettingsStore } from "../apps/api/dist/mailSettingsStore.js";
import { MailDeliveryService } from "../apps/api/dist/mailDelivery.js";

const root = mkdtempSync(join(tmpdir(), "oeap-mail-settings-"));

try {
  const dataPath = join(root, "mail-settings.enc");
  const keyPath = join(root, "mail-settings.key");
  const store = new MailSettingsStore(dataPath, keyPath);

  assert.equal(store.get("org_a").provider, "manual");

  store.update("org_a", {
    provider: "resend",
    from: "OEAP <noreply@example.com>",
    resendApiKey: "test-resend-value"
  });

  store.update("org_b", {
    provider: "smtp",
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpFrom: "noreply@example.com",
    smtpUser: "mailer@example.com",
    smtpPassword: "test-smtp-value",
    smtpStartTls: true
  });

  const publicA = store.publicView("org_a");
  assert.equal(publicA.provider, "resend");
  assert.equal(publicA.hasResendApiKey, true);
  assert.equal("resendApiKey" in publicA, false);

  const publicB = store.publicView("org_b");
  assert.equal(publicB.provider, "smtp");
  assert.equal(publicB.hasSmtpPassword, true);
  assert.equal(publicB.smtpHost, "smtp.example.com");

  assert.equal(
    new MailDeliveryService(store.get("org_a")).status().activeProvider,
    "resend"
  );
  assert.equal(
    new MailDeliveryService(store.get("org_b")).status().activeProvider,
    "smtp"
  );

  const encrypted = readFileSync(dataPath, "utf8");
  assert.equal(encrypted.includes("test-resend-value"), false);
  assert.equal(encrypted.includes("test-smtp-value"), false);
  assert.equal(encrypted.includes("smtp.example.com"), false);

  const reloaded = new MailSettingsStore(dataPath, keyPath);
  assert.equal(reloaded.get("org_a").resendApiKey, "test-resend-value");
  assert.equal(reloaded.get("org_b").smtpPassword, "test-smtp-value");

  console.log("MAIL SETTINGS TEST PASSED");
} finally {
  rmSync(root, { recursive: true, force: true });
}
