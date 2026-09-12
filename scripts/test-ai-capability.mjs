import {
  permissionEngine
} from "../packages/permission-engine/dist/index.js";

import {
  actionGateway
} from "../packages/action-gateway/dist/index.js";

import {
  registerDeepSeekHarnessConnector
} from "../packages/official/deepseek-harness-connector/dist/index.js";

const home = process.env.HOME;

permissionEngine.registerRule({
  id: "allow-ai-generate",
  effect: "allow",
  actions: ["ai.generate"],
  subjects: ["agent:test-agent"],
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

const result = await actionGateway.execute({
  requestId: "ai-capability-test",
  subject: {
    type: "agent",
    id: "test-agent"
  },
  action: "ai.generate",
  capability: "ai.generate",
  input: {
    prompt:
      "请只回复：OEAP_AI_CAPABILITY_OK"
  }
});

console.log(result);

if (
  result.status !== "executed" ||
  !result.output?.text?.includes(
    "OEAP_AI_CAPABILITY_OK"
  )
) {
  throw new Error(
    "AI capability test failed"
  );
}

console.log("");
console.log("✅ AI CAPABILITY TEST PASSED");
