import {
  connectorRuntime
} from "@oeap/connector-runtime";
import {
  registerDeepSeekHarnessConnector
} from "@oeap/deepseek-harness-connector";
import {
  registerOpenAICompatibleConnector,
  validateOpenAICompatibleConfig,
  type OpenAICompatibleConnectorConfig
} from "@oeap/openai-compatible-connector";
import {
  DeepSeekHarnessAdapter
} from "@oeap/harness-adapter";

import {
  ConnectorSecretStore
} from "./connectorSecretStore.js";
import {
  dshHome,
  harnessRoot,
  runtimePath
} from "./runtimePaths.js";

export type AIProviderMode =
  | "auto"
  | "deepseek-harness"
  | "openai-compatible";

export type AIProviderId =
  | "deepseek-harness"
  | "openai-compatible";

export type AIRuntimeStatus = {
  provider: AIProviderId;
  providerMode: AIProviderMode;
  displayName: string;
  available: boolean;
  state: "online" | "offline" | "configured";
  message: string;
  checkedAt: string;
  model?: string;
  endpoint?: string;
  configSource?: "organization-vault" | "environment" | "none";
  warning?: string;
};

export type AIRuntimePublicSettings = {
  providerMode: AIProviderMode;
  selectedProvider: AIProviderId;
  openAICompatible: {
    baseUrl: string;
    model: string;
    timeoutMs: number;
    hasApiKey: boolean;
    configSource:
      | "organization-vault"
      | "environment"
      | "none";
    complete: boolean;
  };
};

export type AIRuntimeTestResult = {
  ok: boolean;
  provider: AIProviderId;
  latencyMs: number;
  response?: string;
  error?: string;
  code?: string;
};

export const OPENAI_COMPATIBLE_CREDENTIAL_ID =
  "oeap.openai-compatible";

let providersRegistered = false;
const vaults = new Map<string, ConnectorSecretStore>();

export function ensureAIRuntimeProvidersRegistered(input: {
  repoRoot: string;
  openEnterpriseRoot: string;
}): void {
  if (providersRegistered) return;

  registerDeepSeekHarnessConnector({
    harnessRoot: harnessRoot(input.openEnterpriseRoot),
    dshHome: dshHome(input.openEnterpriseRoot),
    workspaceRoot: input.repoRoot
  });

  registerOpenAICompatibleConnector({
    priority: 90,
    userAgent: "OEAP/1.1 OpenAI-Compatible",
    resolveConfig(context) {
      const organizationId =
        context?.workspaceId?.trim() || "org_local";
      const resolved = resolveOpenAIConfig(
        input.repoRoot,
        organizationId
      );
      return resolved.complete
        ? resolved.config
        : undefined;
    }
  });

  providersRegistered = true;
}

export async function getAIRuntimeStatus(input: {
  repoRoot: string;
  openEnterpriseRoot: string;
  organizationId: string;
}): Promise<AIRuntimeStatus> {
  ensureAIRuntimeProvidersRegistered(input);

  const settings = getAIRuntimePublicSettings(
    input.repoRoot,
    input.organizationId
  );
  const checkedAt = new Date().toISOString();

  if (settings.selectedProvider === "openai-compatible") {
    const resolved = resolveOpenAIConfig(
      input.repoRoot,
      input.organizationId
    );

    if (!resolved.complete || !resolved.config) {
      return {
        provider: "openai-compatible",
        providerMode: settings.providerMode,
        displayName: "OpenAI-Compatible AI",
        available: false,
        state: "offline",
        message:
          "OpenAI-Compatible Provider 配置不完整，需要 Base URL、API Key 和 Model。",
        checkedAt,
        configSource: resolved.source
      };
    }

    try {
      const validated = validateOpenAICompatibleConfig(
        resolved.config
      );

      return {
        provider: "openai-compatible",
        providerMode: settings.providerMode,
        displayName: "OpenAI-Compatible AI",
        available: true,
        state: "configured",
        message:
          "OpenAI-Compatible Provider 已配置；可执行真实 AI 测试确认网络、密钥与模型。",
        checkedAt,
        model: validated.model,
        endpoint: redactEndpoint(validated.endpoint),
        configSource: resolved.source
      };
    } catch (error) {
      return {
        provider: "openai-compatible",
        providerMode: settings.providerMode,
        displayName: "OpenAI-Compatible AI",
        available: false,
        state: "offline",
        message:
          error instanceof Error
            ? error.message
            : "OpenAI-Compatible Provider 配置无效",
        checkedAt,
        configSource: resolved.source
      };
    }
  }

  const adapter = new DeepSeekHarnessAdapter({
    harnessRoot: harnessRoot(input.openEnterpriseRoot),
    dshHome: dshHome(input.openEnterpriseRoot),
    workspaceRoot: input.repoRoot
  });

  try {
    const result = await adapter.healthCheck();
    const openAI = resolveOpenAIConfig(
      input.repoRoot,
      input.organizationId
    );

    return {
      provider: "deepseek-harness",
      providerMode: settings.providerMode,
      displayName: "DeepSeek Harness",
      available: result.ok,
      state: result.ok ? "online" : "offline",
      message: result.ok
        ? "DeepSeek Harness Runtime 已就绪"
        : result.stderr.includes("timed out")
          ? "DeepSeek Harness 健康检查超时"
          : result.stderr.includes("CLI not built")
            ? "DeepSeek Harness CLI 尚未构建或未安装"
            : "DeepSeek Harness Runtime 当前不可用",
      checkedAt,
      configSource: "none",
      warning:
        settings.providerMode === "auto" &&
        openAI.anyConfigured &&
        !openAI.complete
          ? "检测到不完整的 OpenAI-Compatible 配置，auto 模式已回退 DeepSeek Harness。"
          : undefined
    };
  } catch {
    return {
      provider: "deepseek-harness",
      providerMode: settings.providerMode,
      displayName: "DeepSeek Harness",
      available: false,
      state: "offline",
      message: "DeepSeek Harness Runtime 当前不可用",
      checkedAt,
      configSource: "none"
    };
  }
}

export async function testAIRuntime(input: {
  repoRoot: string;
  openEnterpriseRoot: string;
  organizationId: string;
  prompt?: string;
}): Promise<AIRuntimeTestResult> {
  ensureAIRuntimeProvidersRegistered(input);

  const settings = getAIRuntimePublicSettings(
    input.repoRoot,
    input.organizationId
  );
  const startedAt = Date.now();

  const result = await connectorRuntime.invoke<
    { prompt: string },
    { text: string }
  >({
    capability: "ai.generate",
    preferredProvider: settings.selectedProvider,
    input: {
      prompt:
        input.prompt?.trim() ||
        "只回复 OEAP_AI_RUNTIME_OK，不要解释。"
    },
    context: {
      workspaceId: input.organizationId,
      taskId: `runtime-test:${Date.now()}`
    }
  });

  if (!result.ok) {
    return {
      ok: false,
      provider: settings.selectedProvider,
      latencyMs: Date.now() - startedAt,
      code: result.error?.code,
      error:
        result.error?.message ||
        "AI Runtime 调用失败"
    };
  }

  return {
    ok: true,
    provider: settings.selectedProvider,
    latencyMs: Date.now() - startedAt,
    response:
      typeof result.output?.text === "string"
        ? result.output.text.trim().slice(0, 300)
        : ""
  };
}

export function getPreferredAIProvider(
  repoRoot: string,
  organizationId: string
): AIProviderId {
  return getAIRuntimePublicSettings(
    repoRoot,
    organizationId
  ).selectedProvider;
}

export function getAIRuntimePublicSettings(
  repoRoot: string,
  organizationId: string
): AIRuntimePublicSettings {
  const values = connectorVault(repoRoot).get(
    organizationId,
    OPENAI_COMPATIBLE_CREDENTIAL_ID
  );

  const providerMode = normalizeProviderMode(
    values.PROVIDER_MODE ||
    process.env.OEAP_AI_PROVIDER ||
    "auto"
  );
  const openAI = resolveOpenAIConfig(
    repoRoot,
    organizationId
  );

  const selectedProvider: AIProviderId =
    providerMode === "openai-compatible"
      ? "openai-compatible"
      : providerMode === "deepseek-harness"
        ? "deepseek-harness"
        : openAI.complete
          ? "openai-compatible"
          : "deepseek-harness";

  return {
    providerMode,
    selectedProvider,
    openAICompatible: {
      baseUrl: openAI.baseUrl,
      model: openAI.model,
      timeoutMs: openAI.timeoutMs,
      hasApiKey: openAI.hasApiKey,
      configSource: openAI.source,
      complete: openAI.complete
    }
  };
}

export function updateAIRuntimeSettings(input: {
  repoRoot: string;
  organizationId: string;
  providerMode?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  clearApiKey?: boolean;
}): AIRuntimePublicSettings {
  const current = connectorVault(input.repoRoot).get(
    input.organizationId,
    OPENAI_COMPATIBLE_CREDENTIAL_ID
  );

  const patch: Record<string, string | undefined> = {};

  if (input.providerMode !== undefined) {
    patch.PROVIDER_MODE = normalizeProviderMode(
      input.providerMode
    );
  }
  if (input.baseUrl !== undefined) {
    patch.BASE_URL = input.baseUrl.trim();
  }
  if (input.model !== undefined) {
    patch.MODEL = input.model.trim();
  }
  if (input.apiKey !== undefined && input.apiKey.trim()) {
    patch.API_KEY = input.apiKey.trim();
  }
  if (input.timeoutMs !== undefined) {
    const value = normalizeTimeout(input.timeoutMs);
    patch.TIMEOUT_MS = String(value);
  }

  const clear = input.clearApiKey
    ? ["API_KEY"]
    : [];

  connectorVault(input.repoRoot).update(
    input.organizationId,
    OPENAI_COMPATIBLE_CREDENTIAL_ID,
    patch,
    clear
  );

  const next = getAIRuntimePublicSettings(
    input.repoRoot,
    input.organizationId
  );

  if (
    next.providerMode === "openai-compatible" &&
    next.openAICompatible.complete
  ) {
    const resolved = resolveOpenAIConfig(
      input.repoRoot,
      input.organizationId
    );
    validateOpenAICompatibleConfig(resolved.config!);
  }

  // Avoid treating an accidental blank patch as a destructive operation.
  if (
    Object.keys(patch).length === 0 &&
    clear.length === 0 &&
    Object.keys(current).length === 0
  ) {
    return next;
  }

  return next;
}

function resolveOpenAIConfig(
  repoRoot: string,
  organizationId: string
): {
  config?: OpenAICompatibleConnectorConfig;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  hasApiKey: boolean;
  complete: boolean;
  anyConfigured: boolean;
  source:
    | "organization-vault"
    | "environment"
    | "none";
} {
  const values = connectorVault(repoRoot).get(
    organizationId,
    OPENAI_COMPATIBLE_CREDENTIAL_ID
  );

  const vaultHasRuntimeFields = [
    "BASE_URL",
    "API_KEY",
    "MODEL",
    "TIMEOUT_MS"
  ].some((key) => Boolean(values[key]?.trim()));

  const baseUrl =
    values.BASE_URL?.trim() ||
    process.env.OEAP_OPENAI_BASE_URL?.trim() ||
    "";
  const apiKey =
    values.API_KEY?.trim() ||
    process.env.OEAP_OPENAI_API_KEY?.trim() ||
    "";
  const model =
    values.MODEL?.trim() ||
    process.env.OEAP_OPENAI_MODEL?.trim() ||
    "";
  const timeoutMs = normalizeTimeout(
    values.TIMEOUT_MS ||
    process.env.OEAP_OPENAI_TIMEOUT_MS ||
    120_000
  );

  const envHasRuntimeFields = Boolean(
    process.env.OEAP_OPENAI_BASE_URL?.trim() ||
    process.env.OEAP_OPENAI_API_KEY?.trim() ||
    process.env.OEAP_OPENAI_MODEL?.trim()
  );

  const complete = Boolean(
    baseUrl && apiKey && model
  );
  const source = vaultHasRuntimeFields
    ? "organization-vault" as const
    : envHasRuntimeFields
      ? "environment" as const
      : "none" as const;

  return {
    config: complete
      ? {
          baseUrl,
          apiKey,
          model,
          timeoutMs,
          priority: 90
        }
      : undefined,
    baseUrl,
    model,
    timeoutMs,
    hasApiKey: Boolean(apiKey),
    complete,
    anyConfigured:
      vaultHasRuntimeFields ||
      envHasRuntimeFields,
    source
  };
}

function connectorVault(
  repoRoot: string
): ConnectorSecretStore {
  let store = vaults.get(repoRoot);
  if (!store) {
    store = new ConnectorSecretStore(
      runtimePath(
        repoRoot,
        "settings",
        "connector-secrets.enc"
      ),
      runtimePath(
        repoRoot,
        "settings",
        "connector-secrets.key"
      )
    );
    vaults.set(repoRoot, store);
  }
  return store;
}

function normalizeProviderMode(
  value: unknown
): AIProviderMode {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (
    normalized === "openai-compatible" ||
    normalized === "deepseek-harness" ||
    normalized === "auto"
  ) {
    return normalized;
  }

  throw new Error(
    "AI provider mode must be auto, deepseek-harness or openai-compatible"
  );
}

function normalizeTimeout(
  value: unknown
): number {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(
        Math.max(Math.trunc(number), 5_000),
        300_000
      )
    : 120_000;
}

function redactEndpoint(
  value: string
): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "configured";
  }
}
