import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KnowledgeStore } from "../apps/api/dist/knowledgeStore.js";
import { ConnectorSecretStore } from "../apps/api/dist/connectorSecretStore.js";

const root = mkdtempSync(join(tmpdir(), "oeap-enterprise-core-"));

try {
  const knowledge = new KnowledgeStore(join(root, "knowledge.sqlite"));
  const document = knowledge.create({
    organizationId: "org_test",
    appId: "app_test",
    title: "Merchant onboarding guide",
    source: "Operations handbook",
    text: "商户进件需要营业执照、法人身份证、结算银行卡以及联系人手机号码。审核通过后可以创建支付商户。",
    createdBy: "member_test"
  });

  assert.equal(document.organizationId, "org_test");
  assert.equal(document.chunks, 1);

  const search = knowledge.context({
    organizationId: "org_test",
    appId: "app_test",
    query: "商户进件需要什么资料"
  });
  assert.ok(search.hits.length >= 1);
  assert.match(search.context, /营业执照/);

  const isolated = knowledge.search({
    organizationId: "org_other",
    query: "营业执照"
  });
  assert.equal(isolated.length, 0);

  const vault = new ConnectorSecretStore(
    join(root, "connector-secrets.enc"),
    join(root, "connector-secrets.key")
  );
  vault.update("org_test", "payment.demo", {
    API_KEY: "secret-value",
    MERCHANT_ID: "merchant-001"
  });

  const publicView = vault.publicView("org_test", "payment.demo");
  assert.deepEqual(publicView.keys, ["API_KEY", "MERCHANT_ID"]);
  assert.equal(JSON.stringify(publicView).includes("secret-value"), false);
  assert.equal(vault.get("org_test", "payment.demo").API_KEY, "secret-value");
  assert.deepEqual(vault.get("org_other", "payment.demo"), {});

  console.log("✅ ENTERPRISE CORE TEST PASSED");
} finally {
  rmSync(root, { recursive: true, force: true });
}
