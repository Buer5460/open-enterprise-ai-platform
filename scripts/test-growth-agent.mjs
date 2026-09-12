import {
  permissionEngine
} from "../packages/permission-engine/dist/index.js";

import {
  connectorRuntime
} from "../packages/connector-runtime/dist/index.js";

import {
  packageManager
} from "../packages/package-manager/dist/index.js";

import {
  agentRuntime
} from "../packages/agent-runtime/dist/index.js";

import {
  packageModule as skillPackage
} from "../packages/official/social-first-touch/dist/index.js";

import {
  packageModule as agentPackage
} from "../packages/official/growth-agent/dist/index.js";

permissionEngine.registerRule({
  id: "growth-social-auto",
  effect: "allow",
  actions: [
    "social.like",
    "social.follow",
    "social.dm"
  ],
  subjects: ["agent:oeap.growth-agent"],
  priority: 100
});

connectorRuntime.register({
  executor: {
    id: "mock-social-agent-test",
    packageId: "@oeap/mock-social",
    version: "1.0.0",
    transport: "local",

    async execute(capability, input) {
      return {
        ok: true,
        output: {
          capability,
          input
        }
      };
    }
  },

  capabilities: [
    { id: "social.like" },
    { id: "social.follow" },
    { id: "social.dm" }
  ]
});

await packageManager.install(skillPackage);
await packageManager.enable(skillPackage.manifest.id);

await packageManager.install(agentPackage);
await packageManager.enable(agentPackage.manifest.id);

const result = await agentRuntime.run({
  agentId: "oeap.growth-agent",
  taskId: "growth-agent-test",
  input: {
    leadId: "lead-001",
    profileUrl: "https://example.com/person",
    message: "Hello, nice to connect."
  }
});

console.log("AGENT RESULT:");
console.log(result);

if (!result.ok) {
  throw new Error("Growth Agent failed");
}

if (
  result.output.firstTouch.like !== "executed" ||
  result.output.firstTouch.follow !== "executed" ||
  result.output.firstTouch.dm !== "executed"
) {
  throw new Error("Growth Agent actions failed");
}

console.log("");
console.log("✅ GROWTH AGENT TEST PASSED");
