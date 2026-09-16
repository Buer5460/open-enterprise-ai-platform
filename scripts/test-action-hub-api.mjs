import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const apiPort = 26000 + Math.floor(Math.random() * 2000);
const dataDir = await mkdtemp(
  join(tmpdir(), "oeap-action-hub-api-")
);
const apiBase = `http://127.0.0.1:${apiPort}`;

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
      OEAP_DATA_DIR: dataDir
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

  const summary = await requestJson(
    "/api/action-hub/summary",
    { headers: authorization }
  );
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.ok, true);
  assert.equal(summary.body.summary.adapters, 7);
  assert.ok(summary.body.summary.actions >= 3);

  const initialActions = await requestJson(
    "/api/action-hub/actions",
    { headers: authorization }
  );
  assert.equal(initialActions.response.status, 200);
  assert.ok(
    initialActions.body.actions.some(
      (item) => item.id === "ai.generate" && item.enabled === true
    )
  );

  const actionId = "test.external.write";
  const actionDefinition = {
    id: actionId,
    version: "1.0.0",
    displayName: "External write test",
    description: "Exercises the R2 approval path without invoking a connector.",
    capability: "test.external.write",
    permissionAction: "apps.read",
    risk: "R2",
    enabled: true,
    inputSchema: {
      type: "object",
      required: ["secret"],
      properties: {
        secret: { type: "string" }
      }
    }
  };

  const saved = await requestJson(
    `/api/action-hub/actions/${actionId}`,
    {
      method: "PUT",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(actionDefinition)
    }
  );
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.ok, true);
  assert.equal(saved.body.action.risk, "R2");

  const secret = "ACTION_HUB_API_SECRET_PAYLOAD";
  const requested = await requestJson(
    `/api/action-hub/actions/${actionId}/execute`,
    {
      method: "POST",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: { secret }
      })
    }
  );
  assert.equal(requested.response.status, 202);
  assert.equal(requested.body.ok, true);
  assert.equal(
    requested.body.status,
    "approval_required"
  );
  assert.equal(
    requested.body.approval.actionId,
    actionId
  );

  const approvals = await requestJson(
    "/api/action-hub/approvals?status=pending",
    { headers: authorization }
  );
  assert.equal(approvals.response.status, 200);
  assert.ok(
    approvals.body.approvals.some(
      (item) => item.id === requested.body.approval.id
    )
  );

  const rejected = await requestJson(
    `/api/action-hub/approvals/${requested.body.approval.id}/decision`,
    {
      method: "POST",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        decision: "rejected"
      })
    }
  );
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.body.status, "rejected");

  const adapter = await requestJson(
    `/api/action-hub/actions/${actionId}/adapters?adapter=apple-app-intents`,
    { headers: authorization }
  );
  assert.equal(adapter.response.status, 200);
  assert.equal(
    adapter.body.compilations[0].adapter,
    "apple-app-intents"
  );
  assert.match(
    adapter.body.compilations[0].source,
    /AppIntent/
  );

  const openapi = await requestJson(
    "/api/action-hub/openapi.json",
    { headers: authorization }
  );
  assert.equal(openapi.response.status, 200);
  assert.equal(openapi.body.openapi, "3.1.0");
  assert.ok(
    openapi.body.paths[
      `/api/action-hub/actions/${actionId}/execute`
    ]
  );

  const discovery = await requestJson(
    "/api/action-hub/mcp",
    modernMcpRequest(
      authorization,
      "server/discover",
      1,
      {}
    )
  );
  assert.equal(discovery.response.status, 200);
  assert.equal(
    discovery.body.result.serverInfo.name,
    "oeap-ai-action-hub"
  );
  assert.ok(
    discovery.body.result.supportedVersions.includes(
      "2026-07-28"
    )
  );

  const toolList = await requestJson(
    "/api/action-hub/mcp",
    modernMcpRequest(
      authorization,
      "tools/list",
      2,
      {}
    )
  );
  assert.equal(toolList.response.status, 200);
  assert.ok(
    toolList.body.result.tools.some(
      (tool) => tool.name === actionId
    )
  );

  const mcpCall = await requestJson(
    "/api/action-hub/mcp",
    modernMcpRequest(
      authorization,
      "tools/call",
      3,
      {
        name: actionId,
        arguments: {
          secret: "MCP_APPROVAL_SECRET"
        }
      },
      actionId
    )
  );
  assert.equal(mcpCall.response.status, 200);
  assert.equal(
    mcpCall.body.result.structuredContent.status,
    "approval_required"
  );

  const riskActionId = "test.money.move";
  const riskSaved = await requestJson(
    `/api/action-hub/actions/${riskActionId}`,
    {
      method: "PUT",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: riskActionId,
        version: "1.0.0",
        displayName: "High risk test",
        description: "Tests R3 explicit confirmation.",
        capability: "test.money.move",
        permissionAction: "apps.read",
        risk: "R3",
        enabled: true,
        inputSchema: {
          type: "object",
          required: ["amount"],
          properties: {
            amount: { type: "number" }
          }
        }
      })
    }
  );
  assert.equal(riskSaved.response.status, 200);

  const riskRequested = await requestJson(
    `/api/action-hub/actions/${riskActionId}/execute`,
    {
      method: "POST",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: { amount: 100 }
      })
    }
  );
  assert.equal(riskRequested.response.status, 202);
  assert.equal(riskRequested.body.confirmationRequired, true);

  const wrongConfirmation = await requestJson(
    `/api/action-hub/approvals/${riskRequested.body.approval.id}/decision`,
    {
      method: "POST",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        decision: "approved",
        confirmation: "wrong.action"
      })
    }
  );
  assert.equal(wrongConfirmation.response.status, 400);

  const riskRejected = await requestJson(
    `/api/action-hub/approvals/${riskRequested.body.approval.id}/decision`,
    {
      method: "POST",
      headers: {
        ...authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        decision: "rejected"
      })
    }
  );
  assert.equal(riskRejected.response.status, 200);

  const encrypted = await readFile(
    join(
      dataDir,
      "action-hub",
      "action-hub.enc.json"
    ),
    "utf8"
  );
  assert.equal(encrypted.includes(secret), false);
  assert.equal(
    encrypted.includes("MCP_APPROVAL_SECRET"),
    false
  );

  const events = await requestJson(
    "/api/action-hub/events?limit=100",
    { headers: authorization }
  );
  assert.equal(events.response.status, 200);
  assert.ok(
    events.body.events.some(
      (item) => item.status === "approval_required"
    )
  );

  console.log(
    "✅ AI ACTION HUB REST + MCP + APPROVAL E2E PASSED"
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
  await rm(
    dataDir,
    { recursive: true, force: true }
  );
}

function modernMcpRequest(
  authorization,
  method,
  id,
  params,
  name
) {
  const meta = {
    "io.modelcontextprotocol/protocolVersion":
      "2026-07-28"
  };

  return {
    method: "POST",
    headers: {
      ...authorization,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(name ? { "Mcp-Name": name } : {})
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: meta
      }
    })
  };
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
