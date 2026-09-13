import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const apiPort = 24000 + Math.floor(Math.random() * 2000);
const dataDir = await mkdtemp(
  join(tmpdir(), "oeap-ai-runtime-e2e-")
);
const apiBase = `http://127.0.0.1:${apiPort}`;

const modelServer = http.createServer(
  async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk.toString();
    }

    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(
      request.headers.authorization,
      "Bearer encrypted-tenant-ai-secret"
    );

    const parsed = JSON.parse(body);
    assert.equal(parsed.model, "oeap-test-model");
    const prompt = String(
      parsed.messages?.[0]?.content ?? ""
    );

    const content = prompt.includes("OEAP_AI_RUNTIME_OK")
      ? "OEAP_AI_RUNTIME_OK"
      : JSON.stringify({
          appName: "兼容模型测试应用",
          summary: "由 OpenAI-Compatible Provider 生成的测试应用",
          roles: [
            {
              name: "管理员",
              description: "管理测试数据",
              permissions: ["*"]
            }
          ],
          entities: [
            {
              name: "Customer",
              description: "测试客户",
              fields: [
                {
                  name: "name",
                  label: "客户名称",
                  type: "string",
                  required: true
                },
                {
                  name: "status",
                  label: "状态",
                  type: "enum",
                  required: true,
                  options: ["潜在", "成交"]
                }
              ]
            }
          ],
          pages: [
            {
              id: "customers",
              label: "客户管理",
              purpose: "维护客户"
            }
          ],
          workflows: [
            {
              name: "客户流程",
              description: "测试流程",
              steps: ["录入", "跟进"]
            }
          ],
          recommendedPackages: {
            skills: [],
            agents: [],
            connectors: []
          }
        });

    response.writeHead(200, {
      "Content-Type": "application/json",
      "x-request-id": "oeap-mock-ai-request"
    });
    response.end(JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content
          }
        }
      ]
    }));
  }
);

await new Promise((resolve) =>
  modelServer.listen(0, "127.0.0.1", resolve)
);

const modelAddress = modelServer.address();
assert.ok(
  modelAddress && typeof modelAddress === "object"
);
const modelBase =
  `http://127.0.0.1:${modelAddress.port}/v1`;

const child = spawn(
  process.execPath,
  ["apps/api/dist/index.js"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OEAP_API_PORT: String(apiPort),
      OEAP_API_HOST: "127.0.0.1",
      OEAP_DEPLOYMENT_MODE: "development",
      OEAP_LOCAL_AUTH: "enabled",
      OEAP_DATA_DIR: dataDir,
      OEAP_AI_PROVIDER: "auto",
      OEAP_OPENAI_BASE_URL: "",
      OEAP_OPENAI_API_KEY: "",
      OEAP_OPENAI_MODEL: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  }
);

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForHealth();

  const login = await requestJson(
    "/api/auth/local",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: "{}"
    }
  );
  assert.equal(login.response.status, 200);
  assert.equal(login.body.ok, true);

  const authorization = {
    Authorization: `Bearer ${login.body.token}`
  };

  const initial = await requestJson(
    "/api/ai-runtime/settings",
    { headers: authorization }
  );
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.settings.providerMode, "auto");
  assert.equal(
    initial.body.settings.openAICompatible.hasApiKey,
    false
  );

  const saved = await requestJson(
    "/api/ai-runtime/settings",
    {
      method: "PUT",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        providerMode: "openai-compatible",
        baseUrl: modelBase,
        model: "oeap-test-model",
        apiKey: "encrypted-tenant-ai-secret",
        timeoutMs: 5000
      })
    }
  );

  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.ok, true);
  assert.equal(
    saved.body.settings.selectedProvider,
    "openai-compatible"
  );
  assert.equal(
    saved.body.settings.openAICompatible.hasApiKey,
    true
  );
  assert.equal(
    JSON.stringify(saved.body).includes(
      "encrypted-tenant-ai-secret"
    ),
    false,
    "API response must never echo the AI API key"
  );

  const vaultRaw = await readFile(
    join(
      dataDir,
      "settings",
      "connector-secrets.enc"
    ),
    "utf8"
  );
  assert.equal(
    vaultRaw.includes("encrypted-tenant-ai-secret"),
    false,
    "AI API key must be encrypted at rest"
  );

  const status = await requestJson(
    "/api/ai-runtime/status",
    { headers: authorization }
  );
  assert.equal(status.response.status, 200);
  assert.equal(status.body.ai.provider, "openai-compatible");
  assert.equal(status.body.ai.available, true);
  assert.equal(status.body.ai.state, "configured");
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      status.body,
      "settings"
    ),
    false,
    "read-only status must not expose provider configuration"
  );

  const test = await requestJson(
    "/api/ai-runtime/test",
    {
      method: "POST",
      headers: authorization
    }
  );
  assert.equal(test.response.status, 200);
  assert.equal(test.body.ok, true);
  assert.equal(test.body.provider, "openai-compatible");
  assert.equal(test.body.response, "OEAP_AI_RUNTIME_OK");

  const generated = await requestJson(
    "/api/apps/generate",
    {
      method: "POST",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        description: "创建一个简单客户管理应用"
      })
    }
  );
  assert.equal(generated.response.status, 200);
  assert.equal(generated.body.ok, true);
  assert.equal(
    generated.body.app.displayName,
    "兼容模型测试应用"
  );

  const usability = await requestJson(
    "/api/usability/status",
    { headers: authorization }
  );
  assert.equal(usability.response.status, 200);
  assert.equal(
    usability.body.ai.provider,
    "openai-compatible"
  );

  console.log(
    "✅ TENANT AI RUNTIME + OPENAI-COMPATIBLE APP BUILDER E2E PASSED"
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
  await new Promise((resolve, reject) =>
    modelServer.close((error) =>
      error ? reject(error) : resolve()
    )
  );
  await rm(
    dataDir,
    { recursive: true, force: true }
  );
}

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `OEAP API exited before readiness (code ${child.exitCode})\n${output}`
      );
    }
    try {
      const response = await fetch(`${apiBase}/health`);
      if (response.ok) return;
    } catch {
      // API is still starting.
    }
    await new Promise((resolve) =>
      setTimeout(resolve, 150)
    );
  }
  throw new Error(
    `Timed out waiting for OEAP API\n${output}`
  );
}

async function requestJson(
  path,
  init = {}
) {
  const response = await fetch(
    `${apiBase}${path}`,
    init
  );
  const body = await response
    .json()
    .catch(() => ({}));
  return { response, body };
}
