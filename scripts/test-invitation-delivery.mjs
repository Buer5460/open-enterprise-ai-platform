import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  InvitationDeliveryStore
} from "../apps/api/dist/invitationDeliveryStore.js";
import {
  MailDeliveryService
} from "../apps/api/dist/mailDelivery.js";

const directory = mkdtempSync(
  join(tmpdir(), "oeap-invite-delivery-")
);

try {
  const databasePath = join(
    directory,
    "tenancy.sqlite"
  );
  const store = new InvitationDeliveryStore(
    databasePath
  );

  const token =
    "test-token-that-must-not-be-stored-as-plain-text";

  store.saveToken("invite_test", token);

  assert.equal(
    store.getToken("invite_test"),
    token
  );

  store.recordEvent({
    invitationId: "invite_test",
    organizationId: "org_test",
    provider: "manual",
    status: "manual"
  });

  const events = store.listEvents(
    "org_test"
  );

  assert.equal(events.length, 1);
  assert.equal(
    events[0].invitationId,
    "invite_test"
  );
  assert.equal(
    store.latestForInvitation("invite_test")?.status,
    "manual"
  );

  store.deleteToken("invite_test");
  assert.equal(
    store.getToken("invite_test"),
    undefined
  );

  for (const key of [
    "OEAP_MAIL_PROVIDER",
    "RESEND_API_KEY",
    "OEAP_MAIL_FROM",
    "OEAP_MAIL_WEBHOOK_URL",
    "OEAP_SMTP_HOST",
    "OEAP_SMTP_FROM"
  ]) {
    delete process.env[key];
  }

  const mail = new MailDeliveryService();
  assert.equal(
    mail.status().activeProvider,
    "manual"
  );

  const result = await mail.send({
    to: "member@example.com",
    subject: "Invitation",
    text: "Invitation",
    html: "<p>Invitation</p>"
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "manual");

  console.log(
    "✅ INVITATION DELIVERY TEST PASSED"
  );
} finally {
  rmSync(directory, {
    recursive: true,
    force: true
  });
}
