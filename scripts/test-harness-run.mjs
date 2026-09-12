import {
  DeepSeekHarnessAdapter
} from "../packages/harness-adapter/dist/index.js";

const home = process.env.HOME;

const adapter = new DeepSeekHarnessAdapter({
  harnessRoot:
    `${home}/Developer/OpenEnterpriseAI/deepseek-harness`,

  dshHome:
    `${home}/Developer/OpenEnterpriseAI/.dsh-dev`,

  workspaceRoot:
    `${home}/Developer/OpenEnterpriseAI/open-enterprise-ai-platform`
});

console.log("Sending task to DeepSeek Harness...");

const result = await adapter.runHeadless(
  "这是 OEAP 与 DeepSeek Harness 的集成测试。请只回复：OEAP_HARNESS_OK"
);

console.log("");
console.log("ok:", result.ok);
console.log("exitCode:", result.exitCode);
console.log("");
console.log("STDOUT:");
console.log(result.stdout);

if (!result.ok) {
  console.log("");
  console.log("STDERR:");
  console.log(result.stderr);
}

