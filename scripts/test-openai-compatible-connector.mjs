import assert from "node:assert/strict";
import http from "node:http";

import {
  connectorRuntime
} from "../packages/connector-runtime/dist/index.js";
import {
  registerOpenAICompatibleConnector,
  validateOpenAICompatibleConfig
} from "../packages/official/openai-compatible-connector/dist/index.js";

assert.throws(
  () => validateOpenAICompatibleConfig({
    baseUrl: "http://example.com/v1",
    apiKey: "unsafe",
    model: "test"
  }),
  /HTTPS/
);

const server = http.createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
  }

  assert.equal(request.method, "POST");
  assert.equal(request.url, "/v1/chat/completions");
  assert.equal(request.headers.authorization, "Bearer tenant-secret");

  const parsed = JSON.parse(body);
  assert.equal(parsed.model, "test-model");
  assert.equal(parsed.messages[0].role, "user");

  response.writeHead(200, {
    "Content-Type": "application/json",
    "x-request-id": "mock-request-1"
  });
  response.end(JSON.stringify({
    choices: [
      {
        message: {
          role: "assistant",
          content: "OEAP_OPENAI_COMPATIBLE_OK"
        }
      }
    ]
  }));
});

await new Promise((resolve) =>
  server.listen(0, "127.0.0.1", resolve)
);

try {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  registerOpenAICompatibleConnector({
    priority: 250,
    resolveConfig(context) {
      if (context?.workspaceId !== "org_test") {
        return undefined;
      }
      return {
        baseUrl,
        apiKey: "tenant-secret",
        model: "test-model",
        timeoutMs: 5000
      };
    }
  });

  const success = await connectorRuntime.invoke({
    capability: "ai.generate",
    preferredProvider: "openai-compatible",
    input: {
      prompt: "hello"
    },
    context: {
      workspaceId: "org_test",
      taskId: "connector-test"
    }
  });

  assert.equal(success.ok, true);
  assert.equal(success.output.text, "OEAP_OPENAI_COMPATIBLE_OK");
  assert.equal(success.metadata.provider, "openai-compatible");
  assert.equal(success.metadata.model, "test-model");

  const missing = await connectorRuntime.invoke({
    capability: "ai.generate",
    preferredProvider: "openai-compatible",
    input: {
      prompt: "hello"
    },
    context: {
      workspaceId: "org_without_config"
    }
  });

  assert.equal(missing.ok, false);
  assert.equal(
    missing.error.code,
    "AI_PROVIDER_NOT_CONFIGURED"
  );

  console.log("✅ OPENAI-COMPATIBLE CONNECTOR TEST PASSED");
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) =>
      error ? reject(error) : resolve()
    )
  );
}
