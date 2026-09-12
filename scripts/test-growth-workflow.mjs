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
  workflowRuntime
} from "../packages/workflow-engine/dist/index.js";

import {
  packageModule as skillPackage
} from "../packages/official/social-first-touch/dist/index.js";

import {
  packageModule as agentPackage
} from "../packages/official/growth-agent/dist/index.js";

import {
  packageModule as workflowPackage
} from "../packages/official/growth-workflow/dist/index.js";

permissionEngine.registerRule({
  id: "growth-workflow-social-auto",
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
    id: "mock-social-workflow-test",
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

await packageManager.install(workflowPackage);
await packageManager.enable(workflowPackage.manifest.id);

const result = await workflowRuntime.run({
  workflowId: "oeap.growth-first-touch-workflow",
  taskId: "growth-workflow-test",
  input: {
    leadId: "lead-001",
    profileUrl: "https://example.com/person",
    message: "Hello, nice to connect."
  }
});

console.log("WORKFLOW RESULT:");
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  throw new Error("Growth Workflow failed");
}

if (
  result.output.firstTouch.like !== "executed" ||
  result.output.firstTouch.follow !== "executed" ||
  result.output.firstTouch.dm !== "executed"
) {
  throw new Error("Growth Workflow actions failed");
}

console.log("");
console.log("✅ GROWTH WORKFLOW TEST PASSED");
