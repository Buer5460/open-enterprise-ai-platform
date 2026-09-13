import assert from "node:assert/strict";

import {
  OEAPClient,
  OEAPRequestError
} from "../packages/sdk/dist/index.js";

const frozenMethods = [
  "setToken",
  "health",
  "session",
  "listApps",
  "generateApp",
  "reviseApp",
  "listEntityRows",
  "createEntityRow",
  "updateEntityRow",
  "deleteEntityRow",
  "listPackages",
  "operationsSummary",
  "listApprovals",
  "createApproval",
  "decideApproval",
  "listFiles",
  "uploadFile",
  "request"
];

const methods = Object.getOwnPropertyNames(
  OEAPClient.prototype
).filter((name) => name !== "constructor");

for (const method of frozenMethods) {
  assert.equal(
    methods.includes(method),
    true,
    `OEAP SDK 1.x contract is missing method: ${method}`
  );
}

const seen = [];
const client = new OEAPClient({
  baseUrl: "https://oeap.example.test/",
  token: "session-token",
  fetch: async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(
      JSON.stringify({ ok: true }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
});

await client.health();
assert.equal(seen[0].url, "https://oeap.example.test/health");
assert.equal(
  new Headers(seen[0].init?.headers).has("Authorization"),
  false,
  "health() must stay usable without authentication"
);

await client.session();
assert.equal(
  new Headers(seen[1].init?.headers).get("Authorization"),
  "Bearer session-token"
);

const failureClient = new OEAPClient({
  baseUrl: "https://oeap.example.test",
  fetch: async () => new Response(
    JSON.stringify({ error: "denied" }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json"
      }
    }
  )
});

await assert.rejects(
  () => failureClient.request("/api/test"),
  (error) => {
    assert.equal(error instanceof OEAPRequestError, true);
    assert.equal(error.status, 403);
    assert.equal(error.message, "denied");
    return true;
  }
);

console.log("✅ SDK 1.0 CONTRACT TEST PASSED");
