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

const home = process.env.HOME;

permissionEngine.registerRule({
  id: "app-builder-ai",
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

console.log(
  "正在让 AI 生成第一个企业应用蓝图..."
);

const result =
  await appBuilder.build({
    description:
      "为一家旅行社做一个客户和订单管理系统。销售人员可以管理客户、旅游线路和订单，老板可以查看全部数据和经营统计。需要记录客户来源、跟进状态、订单金额和成交情况。",
    nameHint:
      "旅行社经营管理系统",
    language:
      "zh-CN"
  });

console.log("");
console.log(
  JSON.stringify(
    result.blueprint,
    null,
    2
  )
);

if (
  !result.blueprint.appName ||
  result.blueprint.entities.length === 0 ||
  result.blueprint.pages.length === 0
) {
  throw new Error(
    "App Builder result invalid"
  );
}

console.log("");
console.log(
  "✅ AI APP BUILDER TEST PASSED"
);
