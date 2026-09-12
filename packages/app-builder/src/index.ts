import {
  skillRuntime
} from "@oeap/skill-runtime";

export interface AppBuilderInput {
  description: string;
  nameHint?: string;
  language?: string;
}

export interface AppBlueprint {
  appName: string;
  summary: string;

  roles: Array<{
    name: string;
    description?: string;
    permissions: string[];
  }>;

  entities: Array<{
    name: string;
    description?: string;
    fields: Array<{
      name: string;
      type: string;
      required?: boolean;
    }>;
  }>;

  pages: Array<{
    id: string;
    label: string;
    purpose: string;
  }>;

  workflows: Array<{
    name: string;
    description?: string;
    steps: string[];
  }>;

  recommendedPackages: {
    skills: string[];
    agents: string[];
    connectors: string[];
  };
}

export interface AppBuilderResult {
  blueprint: AppBlueprint;
  rawAIResponse: string;
}

export interface AppRevisionInput {
  blueprint: AppBlueprint;
  instruction: string;
  language?: string;
}

function parseBlueprint(
  text: string
): AppBlueprint {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");

  if (
    first === -1 ||
    last === -1 ||
    last <= first
  ) {
    throw new Error(
      "AI did not return a valid JSON object"
    );
  }

  const json = text.slice(first, last + 1);

  const parsed =
    JSON.parse(json) as Partial<AppBlueprint>;

  if (
    typeof parsed.appName !== "string" ||
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.roles) ||
    !Array.isArray(parsed.entities) ||
    !Array.isArray(parsed.pages) ||
    !Array.isArray(parsed.workflows) ||
    !parsed.recommendedPackages ||
    !Array.isArray(parsed.recommendedPackages.skills) ||
    !Array.isArray(parsed.recommendedPackages.agents) ||
    !Array.isArray(parsed.recommendedPackages.connectors)
  ) {
    throw new Error(
      "AI App Blueprint schema is invalid"
    );
  }

  return parsed as AppBlueprint;
}

async function generateBlueprint(
  prompt: string,
  taskPrefix: string
): Promise<AppBuilderResult> {
  const result = await skillRuntime.run<
    { prompt: string },
    { text: string }
  >({
    skillId: "oeap.ai-generate",
    agentId: "oeap.app-builder",
    taskId: `${taskPrefix}:${Date.now()}`,
    input: {
      prompt
    }
  });

  if (
    !result.ok ||
    !result.output
  ) {
    throw new Error(
      result.error?.message ??
      "AI App Builder failed"
    );
  }

  return {
    blueprint:
      parseBlueprint(result.output.text),
    rawAIResponse:
      result.output.text
  };
}

const schemaInstruction = `
必须只返回 JSON，不要 Markdown，不要解释。

返回结构必须严格为：

{
  "appName": "应用名称",
  "summary": "应用简介",
  "roles": [
    {
      "name": "角色名称",
      "description": "角色说明",
      "permissions": ["权限"]
    }
  ],
  "entities": [
    {
      "name": "数据实体",
      "description": "实体说明",
      "fields": [
        {
          "name": "字段名",
          "type": "string",
          "required": true
        }
      ]
    }
  ],
  "pages": [
    {
      "id": "page-id",
      "label": "页面名称",
      "purpose": "页面用途"
    }
  ],
  "workflows": [
    {
      "name": "流程名称",
      "description": "流程说明",
      "steps": ["步骤1", "步骤2"]
    }
  ],
  "recommendedPackages": {
    "skills": [],
    "agents": [],
    "connectors": []
  }
}
`;

export class AIAppBuilder {
  async build(
    input: AppBuilderInput
  ): Promise<AppBuilderResult> {
    const language =
      input.language ?? "zh-CN";

    const prompt = `
你是一名企业软件产品经理和系统架构师。

用户希望创建一个企业应用。

业务需求：
${input.description}

${input.nameHint ? `应用名称参考：${input.nameHint}` : ""}

请先理解业务，再设计应用蓝图。

${schemaInstruction}

输出语言：${language}
`;

    return generateBlueprint(
      prompt,
      "app-builder"
    );
  }

  async revise(
    input: AppRevisionInput
  ): Promise<AppBuilderResult> {
    const language =
      input.language ?? "zh-CN";

    const prompt = `
你是一名企业软件产品经理和系统架构师，正在修改一个已经存在并且已有真实业务数据的企业应用。

当前应用蓝图：
${JSON.stringify(input.blueprint, null, 2)}

用户提出的修改要求：
${input.instruction}

请基于当前蓝图生成修改后的完整蓝图。

规则：
1. 未被修改要求涉及的角色、数据实体、字段、页面、流程和推荐包必须尽量保留。
2. 除非用户明确要求，不要删除已有实体或字段，避免破坏已有数据。
3. 除非用户明确要求重命名应用，否则保持 appName 不变。
4. 新增字段时使用稳定、简洁的英文字段名。
5. 页面 id 使用稳定的小写英文与连字符；已有页面 id 尽量保持不变。
6. 输出必须是完整蓝图，不是 diff。

${schemaInstruction}

输出语言：${language}
`;

    return generateBlueprint(
      prompt,
      "app-revision"
    );
  }
}

export const appBuilder =
  new AIAppBuilder();
