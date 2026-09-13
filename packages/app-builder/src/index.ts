import {
  skillRuntime
} from "@oeap/skill-runtime";

export interface AppBuilderExecutionContext {
  workspaceId?: string;
  userId?: string;
  preferredProvider?: string;
}

export interface AppBuilderInput
  extends AppBuilderExecutionContext {
  description: string;
  nameHint?: string;
  language?: string;
}

export interface AppFieldBlueprint {
  name: string;
  label?: string;
  type: string;
  required?: boolean;
  options?: string[];
  relationEntity?: string;
  relationDisplayField?: string;
  description?: string;
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
    fields: AppFieldBlueprint[];
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

export interface AppRevisionInput
  extends AppBuilderExecutionContext {
  blueprint: AppBlueprint;
  instruction: string;
  language?: string;
}

const FIELD_TYPES = new Set([
  "string",
  "text",
  "richtext",
  "number",
  "integer",
  "currency",
  "boolean",
  "date",
  "datetime",
  "email",
  "phone",
  "url",
  "enum",
  "attachment",
  "relation",
  "json"
]);

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

  return validateAndNormalizeBlueprint(
    parsed as AppBlueprint
  );
}

function validateAndNormalizeBlueprint(
  blueprint: AppBlueprint
): AppBlueprint {
  if (
    !blueprint.appName.trim() ||
    !blueprint.summary.trim()
  ) {
    throw new Error(
      "AI App Blueprint requires appName and summary"
    );
  }

  const entityNames = new Set<string>();
  const entities = blueprint.entities.map(
    (entity, entityIndex) => {
      if (
        !entity ||
        typeof entity.name !== "string" ||
        !entity.name.trim() ||
        !Array.isArray(entity.fields)
      ) {
        throw new Error(
          `AI App Blueprint entity ${entityIndex + 1} is invalid`
        );
      }

      const name = stableIdentifier(
        entity.name,
        `Entity${entityIndex + 1}`
      );

      if (entityNames.has(name)) {
        throw new Error(
          `Duplicate data entity: ${name}`
        );
      }
      entityNames.add(name);

      const fieldNames = new Set<string>();
      const fields = entity.fields.map(
        (field, fieldIndex) => {
          if (
            !field ||
            typeof field.name !== "string" ||
            !field.name.trim()
          ) {
            throw new Error(
              `Invalid field in ${name} at position ${fieldIndex + 1}`
            );
          }

          const fieldName = stableIdentifier(
            field.name,
            `field${fieldIndex + 1}`,
            true
          );

          if (fieldNames.has(fieldName)) {
            throw new Error(
              `Duplicate field ${name}.${fieldName}`
            );
          }
          fieldNames.add(fieldName);

          const type = normalizeFieldType(
            String(field.type || "string")
          );
          const options = Array.isArray(field.options)
            ? [...new Set(
                field.options
                  .map((value) => String(value).trim())
                  .filter(Boolean)
              )].slice(0, 100)
            : undefined;

          if (
            type === "enum" &&
            (!options || options.length === 0)
          ) {
            throw new Error(
              `Enum field ${name}.${fieldName} requires options`
            );
          }

          if (
            type === "relation" &&
            !field.relationEntity?.trim()
          ) {
            throw new Error(
              `Relation field ${name}.${fieldName} requires relationEntity`
            );
          }

          return {
            name: fieldName,
            label:
              field.label?.trim() ||
              field.name.trim(),
            type,
            required: Boolean(field.required),
            options,
            relationEntity:
              field.relationEntity?.trim(),
            relationDisplayField:
              field.relationDisplayField?.trim(),
            description:
              field.description?.trim()
          } satisfies AppFieldBlueprint;
        }
      );

      return {
        name,
        description: entity.description?.trim(),
        fields
      };
    }
  );

  const pageIds = new Set<string>();
  const pages = blueprint.pages.map(
    (page, index) => {
      if (
        !page ||
        typeof page.label !== "string" ||
        !page.label.trim()
      ) {
        throw new Error(
          `AI App Blueprint page ${index + 1} is invalid`
        );
      }

      const id = slugIdentifier(
        String(page.id || page.label),
        `page-${index + 1}`
      );
      const uniqueId = pageIds.has(id)
        ? `${id}-${index + 1}`
        : id;
      pageIds.add(uniqueId);

      return {
        id: uniqueId,
        label: page.label.trim(),
        purpose:
          String(page.purpose || page.label).trim()
      };
    }
  );

  const roles = blueprint.roles.map((role) => ({
    name: String(role.name || "Member").trim(),
    description: role.description?.trim(),
    permissions: Array.isArray(role.permissions)
      ? role.permissions
          .map((permission) => String(permission).trim())
          .filter(Boolean)
      : []
  }));

  const workflows = blueprint.workflows.map(
    (workflow) => ({
      name: String(workflow.name || "Workflow").trim(),
      description: workflow.description?.trim(),
      steps: Array.isArray(workflow.steps)
        ? workflow.steps
            .map((step) => String(step).trim())
            .filter(Boolean)
        : []
    })
  );

  return {
    appName: blueprint.appName.trim(),
    summary: blueprint.summary.trim(),
    roles,
    entities,
    pages,
    workflows,
    recommendedPackages: {
      skills: normalizePackageList(
        blueprint.recommendedPackages.skills
      ),
      agents: normalizePackageList(
        blueprint.recommendedPackages.agents
      ),
      connectors: normalizePackageList(
        blueprint.recommendedPackages.connectors
      )
    }
  };
}

async function generateBlueprint(
  prompt: string,
  taskPrefix: string,
  context: AppBuilderExecutionContext = {}
): Promise<AppBuilderResult> {
  const result = await skillRuntime.run<
    { prompt: string },
    { text: string }
  >({
    skillId: "oeap.ai-generate",
    agentId: "oeap.app-builder",
    taskId: `${taskPrefix}:${Date.now()}`,
    workspaceId: context.workspaceId,
    userId: context.userId,
    metadata: context.preferredProvider
      ? {
          preferredProvider:
            context.preferredProvider
        }
      : undefined,
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
      "name": "DataEntity",
      "description": "实体说明",
      "fields": [
        {
          "name": "fieldName",
          "label": "字段显示名称",
          "type": "string",
          "required": true,
          "description": "字段说明",
          "options": ["仅 enum 类型使用"],
          "relationEntity": "仅 relation 类型使用，填写目标实体名",
          "relationDisplayField": "仅 relation 类型使用，填写目标实体的显示字段"
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

字段 type 只允许：
string、text、richtext、number、integer、currency、boolean、date、datetime、email、phone、url、enum、attachment、relation、json。

规则：
- enum 必须提供 options。
- relation 必须提供 relationEntity，优先提供 relationDisplayField。
- attachment 用于合同、图片、证件、附件等企业文件。
- currency 用于金额，number/integer 用于数值。
- richtext 用于备注、说明、方案正文等长内容。
- 字段 name 使用稳定、简洁的英文 camelCase，不要使用中文字段名。
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

请先理解业务，再设计应用蓝图。对真实企业业务，合理使用枚举、金额、日期、附件、关联字段，不要把所有字段都设计成 string。

${schemaInstruction}

输出语言：${language}
`;

    return generateBlueprint(
      prompt,
      "app-builder",
      input
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
4. 新增字段时使用稳定、简洁的英文 camelCase 字段名，并提供中文 label。
5. 页面 id 使用稳定的小写英文与连字符；已有页面 id 尽量保持不变。
6. 对金额、枚举、附件、日期、关联等字段使用对应字段类型，不要退化为 string。
7. 输出必须是完整蓝图，不是 diff。

${schemaInstruction}

输出语言：${language}
`;

    return generateBlueprint(
      prompt,
      "app-revision",
      input
    );
  }
}

function normalizeFieldType(value: string): string {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    bool: "boolean",
    int: "integer",
    float: "number",
    decimal: "number",
    money: "currency",
    amount: "currency",
    select: "enum",
    choice: "enum",
    file: "attachment",
    image: "attachment",
    textarea: "text",
    markdown: "richtext",
    timestamp: "datetime"
  };
  const result = aliases[normalized] || normalized;
  return FIELD_TYPES.has(result)
    ? result
    : "string";
}

function stableIdentifier(
  value: string,
  fallback: string,
  camel = false
): string {
  const parts = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_\s-]/g, " ")
    .split(/[\s_-]+/)
    .filter(Boolean);

  if (parts.length === 0) return fallback;

  const joined = camel
    ? parts
        .map((part, index) =>
          index === 0
            ? part.charAt(0).toLowerCase() + part.slice(1)
            : part.charAt(0).toUpperCase() + part.slice(1)
        )
        .join("")
    : parts
        .map((part) =>
          part.charAt(0).toUpperCase() + part.slice(1)
        )
        .join("");

  return /^[0-9]/.test(joined)
    ? `${camel ? "field" : "Entity"}${joined}`
    : joined;
}

function slugIdentifier(
  value: string,
  fallback: string
): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizePackageList(
  values: string[]
): string[] {
  return [...new Set(
    values
      .map((value) => String(value).trim())
      .filter(Boolean)
  )];
}

export const appBuilder =
  new AIAppBuilder();
