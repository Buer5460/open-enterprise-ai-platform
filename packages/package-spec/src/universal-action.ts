export type UniversalActionRisk =
  | "R0"
  | "R1"
  | "R2"
  | "R3";

export type UniversalActionAdapter =
  | "mcp"
  | "openapi"
  | "apple-app-intents"
  | "android-appfunctions"
  | "huawei-celia"
  | "xiaomi-agent"
  | "honor-yoyo";

export type UniversalActionJsonSchema =
  Record<string, unknown>;

export interface UniversalActionDefinition {
  id: string;
  version: string;
  displayName: string;
  description: string;
  capability: string;
  permissionAction: string;
  risk: UniversalActionRisk;
  enabled: boolean;
  inputSchema: UniversalActionJsonSchema;
  outputSchema?: UniversalActionJsonSchema;
  permissions?: string[];
  tags?: string[];
  platforms?: UniversalActionAdapter[];
  metadata?: Record<string, unknown>;
}

export interface UniversalActionPolicy {
  risk: UniversalActionRisk;
  readOnly: boolean;
  approvalRequired: boolean;
  explicitConfirmationRequired: boolean;
  unattendedExecutionAllowed: boolean;
}

export interface UniversalActionCompilation {
  adapter: UniversalActionAdapter;
  actionId: string;
  artifact: Record<string, unknown>;
  source?: string;
  requiresVendorAuthorization: boolean;
  notes: string[];
}

export interface UniversalActionValidationResult {
  ok: boolean;
  errors: string[];
}

const ACTION_ID_PATTERN =
  /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const DEFAULT_PLATFORMS: UniversalActionAdapter[] = [
  "mcp",
  "openapi",
  "apple-app-intents",
  "android-appfunctions",
  "huawei-celia",
  "xiaomi-agent",
  "honor-yoyo"
];

export function actionPolicy(
  risk: UniversalActionRisk
): UniversalActionPolicy {
  switch (risk) {
    case "R0":
      return {
        risk,
        readOnly: true,
        approvalRequired: false,
        explicitConfirmationRequired: false,
        unattendedExecutionAllowed: true
      };
    case "R1":
      return {
        risk,
        readOnly: false,
        approvalRequired: false,
        explicitConfirmationRequired: false,
        unattendedExecutionAllowed: true
      };
    case "R2":
      return {
        risk,
        readOnly: false,
        approvalRequired: true,
        explicitConfirmationRequired: false,
        unattendedExecutionAllowed: false
      };
    case "R3":
      return {
        risk,
        readOnly: false,
        approvalRequired: true,
        explicitConfirmationRequired: true,
        unattendedExecutionAllowed: false
      };
  }
}

export function validateUniversalActionDefinition(
  value: unknown
): UniversalActionValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      errors: ["action definition must be an object"]
    };
  }

  requiredString(value, "id", errors);
  requiredString(value, "version", errors);
  requiredString(value, "displayName", errors);
  requiredString(value, "description", errors);
  requiredString(value, "capability", errors);
  requiredString(value, "permissionAction", errors);

  if (
    typeof value.id === "string" &&
    !ACTION_ID_PATTERN.test(value.id)
  ) {
    errors.push(
      "id must start with a lowercase letter and contain lowercase letters, digits, dot, underscore or hyphen"
    );
  }

  if (
    typeof value.version === "string" &&
    !VERSION_PATTERN.test(value.version)
  ) {
    errors.push("version must use semantic version format, for example 1.0.0");
  }

  if (!["R0", "R1", "R2", "R3"].includes(String(value.risk))) {
    errors.push("risk must be one of R0, R1, R2 or R3");
  }

  if (typeof value.enabled !== "boolean") {
    errors.push("enabled must be boolean");
  }

  if (!isRecord(value.inputSchema)) {
    errors.push("inputSchema must be an object");
  } else if (
    value.inputSchema.type !== undefined &&
    value.inputSchema.type !== "object"
  ) {
    errors.push("inputSchema.type must be object when provided");
  }

  if (
    value.outputSchema !== undefined &&
    !isRecord(value.outputSchema)
  ) {
    errors.push("outputSchema must be an object when provided");
  }

  if (
    value.permissions !== undefined &&
    !isStringArray(value.permissions)
  ) {
    errors.push("permissions must be an array of strings");
  }

  if (
    value.tags !== undefined &&
    !isStringArray(value.tags)
  ) {
    errors.push("tags must be an array of strings");
  }

  if (value.platforms !== undefined) {
    if (!Array.isArray(value.platforms)) {
      errors.push("platforms must be an array");
    } else {
      for (const platform of value.platforms) {
        if (!DEFAULT_PLATFORMS.includes(platform as UniversalActionAdapter)) {
          errors.push(`unsupported platform: ${String(platform)}`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function normalizeUniversalActionDefinition(
  value: UniversalActionDefinition
): UniversalActionDefinition {
  const validation =
    validateUniversalActionDefinition(value);

  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  return {
    ...value,
    id: value.id.trim(),
    version: value.version.trim(),
    displayName: value.displayName.trim(),
    description: value.description.trim(),
    capability: value.capability.trim(),
    permissionAction: value.permissionAction.trim(),
    permissions: uniqueStrings(value.permissions ?? []),
    tags: uniqueStrings(value.tags ?? []),
    platforms:
      value.platforms && value.platforms.length > 0
        ? [...new Set(value.platforms)]
        : [...DEFAULT_PLATFORMS],
    metadata: value.metadata ? { ...value.metadata } : undefined
  };
}

export function validateUniversalActionInput(
  definition: UniversalActionDefinition,
  input: unknown
): UniversalActionValidationResult {
  const errors: string[] = [];
  validateSchemaValue(
    definition.inputSchema,
    input,
    "$",
    errors
  );

  return {
    ok: errors.length === 0,
    errors
  };
}

export function compileUniversalAction(
  definition: UniversalActionDefinition,
  adapter: UniversalActionAdapter,
  options: {
    apiBaseUrl?: string;
  } = {}
): UniversalActionCompilation {
  const action =
    normalizeUniversalActionDefinition(definition);
  const apiBaseUrl =
    (options.apiBaseUrl ?? "").replace(/\/+$/, "");
  const executePath =
    `/api/action-hub/actions/${encodeURIComponent(action.id)}/execute`;
  const endpoint = `${apiBaseUrl}${executePath}`;
  const policy = actionPolicy(action.risk);

  switch (adapter) {
    case "mcp":
      return {
        adapter,
        actionId: action.id,
        artifact: {
          name: action.id,
          title: action.displayName,
          description: action.description,
          inputSchema: action.inputSchema,
          annotations: {
            readOnlyHint: policy.readOnly,
            destructiveHint: action.risk === "R3",
            idempotentHint: action.risk === "R0",
            openWorldHint: action.risk !== "R0"
          },
          oeap: {
            risk: action.risk,
            capability: action.capability,
            approvalRequired: policy.approvalRequired
          }
        },
        requiresVendorAuthorization: false,
        notes: [
          "Connect an MCP client to the OEAP Action Hub MCP endpoint and call this tool by action id."
        ]
      };

    case "openapi":
      return {
        adapter,
        actionId: action.id,
        artifact: {
          method: "POST",
          path: executePath,
          operationId: action.id.replace(/[.-]/g, "_"),
          summary: action.displayName,
          description: action.description,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    input: action.inputSchema
                  },
                  required: ["input"]
                }
              }
            }
          },
          responses: {
            "200": { description: "Action executed" },
            "202": { description: "Approval required" },
            "400": { description: "Invalid request" },
            "403": { description: "Forbidden" }
          }
        },
        requiresVendorAuthorization: false,
        notes: ["The REST endpoint is immediately usable with an OEAP authenticated session/token."]
      };

    case "apple-app-intents":
      return {
        adapter,
        actionId: action.id,
        artifact: {
          framework: "AppIntents",
          endpoint,
          actionId: action.id,
          risk: action.risk,
          approvalRequired: policy.approvalRequired
        },
        source: appleIntentSource(action, endpoint),
        requiresVendorAuthorization: true,
        notes: [
          "Add the generated intent to an iOS/macOS app target and supply your authenticated Action Hub client.",
          "App signing, App Intents schemas and any Apple entitlements remain controlled by Apple."
        ]
      };

    case "android-appfunctions":
      return {
        adapter,
        actionId: action.id,
        artifact: {
          library: "androidx.appfunctions",
          endpoint,
          actionId: action.id,
          risk: action.risk,
          approvalRequired: policy.approvalRequired
        },
        source: androidAppFunctionSource(action, endpoint),
        requiresVendorAuthorization: true,
        notes: [
          "Add the generated function to an Android app using Jetpack AppFunctions and KSP.",
          "Android AppFunctions is versioned independently; validate the generated wrapper against the SDK version used by the app."
        ]
      };

    case "huawei-celia":
    case "xiaomi-agent":
    case "honor-yoyo":
      return {
        adapter,
        actionId: action.id,
        artifact: {
          kind: "remote-action",
          provider: adapter,
          actionId: action.id,
          displayName: action.displayName,
          description: action.description,
          inputSchema: action.inputSchema,
          outputSchema: action.outputSchema,
          endpoint,
          method: "POST",
          risk: action.risk,
          approvalRequired: policy.approvalRequired,
          auth: {
            type: "oeap-session-or-enterprise-gateway"
          }
        },
        requiresVendorAuthorization: true,
        notes: [
          "Use this contract when creating the vendor Agent/Skill/MCP entry.",
          "Publishing, review and account authorization are completed in the vendor developer console."
        ]
      };
  }
}

export function supportedUniversalActionAdapters(): UniversalActionAdapter[] {
  return [...DEFAULT_PLATFORMS];
}

function validateSchemaValue(
  schema: UniversalActionJsonSchema,
  value: unknown,
  path: string,
  errors: string[]
): void {
  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && !enumValues.some((item) => Object.is(item, value))) {
    errors.push(`${path} must be one of the declared enum values`);
    return;
  }

  const type = typeof schema.type === "string"
    ? schema.type
    : undefined;

  if (type === "object") {
    if (!isRecord(value)) {
      errors.push(`${path} must be an object`);
      return;
    }

    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];
    const properties = isRecord(schema.properties)
      ? schema.properties
      : {};

    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${path}.${key} is required`);
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value && isRecord(childSchema)) {
        validateSchemaValue(
          childSchema,
          value[key],
          `${path}.${key}`,
          errors
        );
      }
    }

    return;
  }

  if (type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array`);
      return;
    }

    if (isRecord(schema.items)) {
      value.forEach((item, index) => {
        validateSchemaValue(
          schema.items as UniversalActionJsonSchema,
          item,
          `${path}[${index}]`,
          errors
        );
      });
    }
    return;
  }

  if (type === "string" && typeof value !== "string") {
    errors.push(`${path} must be a string`);
  } else if (type === "number" && typeof value !== "number") {
    errors.push(`${path} must be a number`);
  } else if (
    type === "integer" &&
    (typeof value !== "number" || !Number.isInteger(value))
  ) {
    errors.push(`${path} must be an integer`);
  } else if (type === "boolean" && typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
  }
}

function appleIntentSource(
  action: UniversalActionDefinition,
  endpoint: string
): string {
  const typeName = sourceTypeName(action.id, "Intent");
  return `import AppIntents\nimport Foundation\n\nstruct ${typeName}: AppIntent {\n    static var title: LocalizedStringResource = \"${escapeSource(action.displayName)}\"\n    static var description = IntentDescription(\"${escapeSource(action.description)}\")\n\n    @Parameter(title: \"JSON Payload\")\n    var payloadJSON: String\n\n    func perform() async throws -> some IntentResult & ReturnsValue<String> {\n        // Send payloadJSON as { \"input\": <decoded JSON> } to your authenticated Action Hub client.\n        // Endpoint: ${escapeSource(endpoint)}\n        return .result(value: payloadJSON)\n    }\n}\n`;
}

function androidAppFunctionSource(
  action: UniversalActionDefinition,
  endpoint: string
): string {
  const functionName = sourceFunctionName(action.id);
  return `import androidx.appfunctions.AppFunction\n\nclass OeapActionFunctions {\n    @AppFunction\n    suspend fun ${functionName}(payloadJson: String): String {\n        // POST { \"input\": <decoded payloadJson> } using your authenticated Action Hub client.\n        // Endpoint: ${escapeSource(endpoint)}\n        return payloadJson\n    }\n}\n`;
}

function sourceTypeName(
  id: string,
  suffix: string
): string {
  return id
    .split(/[._-]+/)
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join("") + suffix;
}

function sourceFunctionName(id: string): string {
  const parts = id.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return "executeAction";
  return parts[0] + parts
    .slice(1)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join("");
}

function escapeSource(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\"/g, "\\\"")
    .replace(/\n/g, " ");
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  errors: string[]
): void {
  if (
    typeof value[key] !== "string" ||
    !(value[key] as string).trim()
  ) {
    errors.push(`${key} is required`);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
