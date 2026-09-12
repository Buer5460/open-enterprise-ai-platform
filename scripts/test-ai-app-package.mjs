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
  packageModule as aiSkillPackage
} from "../packages/official/ai-generate-skill/dist/index.js";

import {
  appBuilder
} from "../packages/app-builder/dist/index.js";

import {
  appPackageBuilder
} from "../packages/app-package-builder/dist/index.js";

const home = process.env.HOME;

permissionEngine.registerRule({
  id: "app-package-builder-ai",
  effect: "allow",
  actions: ["ai.generate"],
  subjects: ["agent:oeap.app-builder"],
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

await packageManager.install(
  aiSkillPackage
);

await packageManager.enable(
  aiSkillPackage.manifest.id
);

console.log("正在生成企业应用蓝图...");

const app = await appBuilder.build({
  description:
    "为一家支付服务商建立商户管理系统。管理员可以管理渠道经理、商户、交易流水、物料投入和分润。渠道经理只能查看自己名下商户及分润。商户只能查看自己的交易数据。",
  nameHint:
    "支付服务商 ERP",
  language:
    "zh-CN"
});

console.log("正在生成 OEAP App Package...");

const built =
  await appPackageBuilder.build({
    blueprint:
      app.blueprint,

    packageId:
      "demo.payment-service-erp",

    publisher:
      "oeap-demo",

    version:
      "0.0.1",

    outputDir:
      `${home}/Developer/OpenEnterpriseAI/open-enterprise-ai-platform/.tmp/generated-apps`
  });

console.log("");
console.log("APP PACKAGE:");
console.log(built.directory);

console.log("");
console.log(
  JSON.stringify(
    built.manifest,
    null,
    2
  )
);

if (
  built.manifest.type !== "app" ||
  !built.manifest.id ||
  !built.directory
) {
  throw new Error(
    "OEAP App Package generation failed"
  );
}

console.log("");
console.log(
  "✅ AI APP PACKAGE TEST PASSED"
);
