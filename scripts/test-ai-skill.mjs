import {
  permissionEngine
} from "../packages/permission-engine/dist/index.js";

import {
  registerDeepSeekHarnessConnector
} from "../packages/official/deepseek-harness-connector/dist/index.js";

import {
  packageManager
} from "../packages/package-manager/dist/index.js";

import {
  skillRuntime
} from "../packages/skill-runtime/dist/index.js";

import {
  packageModule
} from "../packages/official/ai-generate-skill/dist/index.js";

const home = process.env.HOME;

permissionEngine.registerRule({
  id: "allow-ai-skill",
  effect: "allow",
  actions: ["ai.generate"],
  subjects: ["agent:test-ai-agent"],
  priority: 100
});

registerDeepSeekHarnessConnector({
  harnessRoot:
    `${home}/Developer/OpenEnterpriseAI/deepseek-harness`,
  dshHome:
    `${home}/Developer/OpenEnterpriseAI/.dsh-dev`,
  workspaceRoot:
    `${home}/Developer/OpenEnterpriseAI/open-enterprise-ai-platform`
});

await packageManager.install(packageModule);
await packageManager.enable(packageModule.manifest.id);

const result = await skillRuntime.run({
  skillId: "oeap.ai-generate",
  agentId: "test-ai-agent",
  taskId: "ai-skill-test",
  input: {
    prompt: "请只回复：OEAP_AI_SKILL_OK"
  }
});

console.log(result);

if (
  !result.ok ||
  !result.output?.text?.includes("OEAP_AI_SKILL_OK")
) {
  throw new Error("AI Skill test failed");
}

console.log("");
console.log("✅ AI SKILL TEST PASSED");
