import assert from "node:assert/strict";

import {
  actionPolicy,
  compileUniversalAction,
  supportedUniversalActionAdapters,
  validateUniversalActionDefinition,
  validateUniversalActionInput
} from "../packages/package-spec/dist/index.js";

const action = {
  id: "crm.customer.search",
  version: "1.0.0",
  displayName: "Search customers",
  description: "Search CRM customers",
  capability: "crm.customer.search",
  permissionAction: "crm.read",
  risk: "R0",
  enabled: true,
  inputSchema: {
    type: "object",
    required: ["keyword"],
    properties: {
      keyword: { type: "string" },
      limit: { type: "integer" }
    }
  }
};

assert.equal(
  validateUniversalActionDefinition(action).ok,
  true
);
assert.equal(
  validateUniversalActionInput(action, {
    keyword: "Acme",
    limit: 5
  }).ok,
  true
);
assert.equal(
  validateUniversalActionInput(action, {
    limit: "5"
  }).ok,
  false
);

assert.deepEqual(
  actionPolicy("R0"),
  {
    risk: "R0",
    readOnly: true,
    approvalRequired: false,
    explicitConfirmationRequired: false,
    unattendedExecutionAllowed: true
  }
);
assert.equal(actionPolicy("R2").approvalRequired, true);
assert.equal(actionPolicy("R3").explicitConfirmationRequired, true);

const adapters = supportedUniversalActionAdapters();
assert.deepEqual(
  adapters,
  [
    "mcp",
    "openapi",
    "apple-app-intents",
    "android-appfunctions",
    "huawei-celia",
    "xiaomi-agent",
    "honor-yoyo"
  ]
);

for (const adapter of adapters) {
  const compilation = compileUniversalAction(
    action,
    adapter,
    { apiBaseUrl: "https://example.test" }
  );

  assert.equal(compilation.adapter, adapter);
  assert.equal(compilation.actionId, action.id);
  assert.ok(compilation.artifact);
}

const mcp = compileUniversalAction(action, "mcp");
assert.equal(mcp.artifact.name, action.id);
assert.equal(mcp.artifact.inputSchema, action.inputSchema);

const openapi = compileUniversalAction(action, "openapi");
assert.equal(openapi.artifact.method, "POST");
assert.equal(
  openapi.artifact.path,
  "/api/action-hub/actions/crm.customer.search/execute"
);

const apple = compileUniversalAction(
  action,
  "apple-app-intents",
  { apiBaseUrl: "https://example.test" }
);
assert.match(apple.source ?? "", /AppIntent/);
assert.equal(apple.requiresVendorAuthorization, true);

const android = compileUniversalAction(
  action,
  "android-appfunctions",
  { apiBaseUrl: "https://example.test" }
);
assert.match(android.source ?? "", /@AppFunction/);
assert.equal(android.requiresVendorAuthorization, true);

console.log("✅ Universal Action Specification tests passed");
