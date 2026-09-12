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
  skillRuntime
} from "../packages/skill-runtime/dist/index.js";

import {
  packageModule
} from "../packages/official/social-first-touch/dist/index.js";

permissionEngine.registerRule({
  id: "growth-social-first-touch",
  effect: "allow",
  actions: [
    "social.like",
    "social.follow",
    "social.dm"
  ],
  subjects: ["agent:growth"],
  priority: 100
});

connectorRuntime.register({
  executor: {
    id: "mock-social",
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

await packageManager.install(packageModule);
await packageManager.enable(packageModule.manifest.id);

const result = await skillRuntime.run({
  skillId: "oeap.social-first-touch",
  agentId: "growth",
  taskId: "demo-first-touch",
  input: {
    leadId: "lead-001",
    profileUrl: "https://example.com/person",
    message: "Hello, nice to connect."
  }
});

console.log("SKILL RESULT:");
console.log(result);

if (!result.ok) {
  throw new Error("Skill execution failed");
}

if (
  result.output.like !== "executed" ||
  result.output.follow !== "executed" ||
  result.output.dm !== "executed"
) {
  throw new Error("First touch actions did not execute");
}

await packageManager.disable(packageModule.manifest.id);
await packageManager.uninstall(packageModule.manifest.id);

console.log("");
console.log("✅ INSTALLABLE SKILL TEST PASSED");
