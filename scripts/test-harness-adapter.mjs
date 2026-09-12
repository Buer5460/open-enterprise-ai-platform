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

const result = await adapter.healthCheck();

console.log("HARNESS ADAPTER:");
console.log("ok:", result.ok);
console.log("exitCode:", result.exitCode);

if (!result.ok) {
  console.log("STDOUT:");
  console.log(result.stdout);

  console.log("STDERR:");
  console.log(result.stderr);

  throw new Error(
    "DeepSeek Harness Adapter health check failed"
  );
}

console.log("");
console.log("✅ HARNESS ADAPTER HEALTH CHECK PASSED");
