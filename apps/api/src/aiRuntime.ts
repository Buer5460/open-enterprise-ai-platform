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

  const providerMode = safeProviderMode(
    values.PROVIDER_MODE ||
    process.env.OEAP_AI_PROVIDER ||
    "auto"
  );
  const openAI = resolveOpenAIConfigFromValues(values);

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
  const store = connectorVault(input.repoRoot);
  const current = store.get(
    input.organizationId,
    OPENAI_COMPATIBLE_CREDENTIAL_ID
  );
  const proposed = { ...current };
  const patch: Record<string, string | undefined> = {};
  const clear: string[] = [];

  if (input.providerMode !== undefined) {
    const mode = normalizeProviderMode(
      input.providerMode
    );
    proposed.PROVIDER_MODE = mode;
    patch.PROVIDER_MODE = mode;
  }

  if (input.baseUrl !== undefined) {
    const value = input.baseUrl.trim();
    if (value) {
      proposed.BASE_URL = value;
      patch.BASE_URL = value;
    } else {
      delete proposed.BASE_URL;
      clear.push("BASE_URL");
    }
  }

  if (input.model !== undefined) {
    const value = input.model.trim();
    if (value) {
      proposed.MODEL = value;
      patch.MODEL = value;
    } else {
      delete proposed.MODEL;
      clear.push("MODEL");
    }
  }

  if (input.apiKey !== undefined && input.apiKey.trim()) {
    const value = input.apiKey.trim();
    proposed.API_KEY = value;
    patch.API_KEY = value;
  }

  if (input.clearApiKey) {
    delete proposed.API_KEY;
    clear.push("API_KEY");
  }

  if (input.timeoutMs !== undefined) {
    const value = normalizeTimeout(input.timeoutMs);
    proposed.TIMEOUT_MS = String(value);
    patch.TIMEOUT_MS = String(value);
  }

  validateProposedSettings(proposed);

  if (
    Object.keys(patch).length === 0 &&
    clear.length === 0
  ) {
    return getAIRuntimePublicSettings(
      input.repoRoot,
      input.organizationId
    );
  }

  store.update(
    input.organizationId,
    OPENAI_COMPATIBLE_CREDENTIAL_ID,
    patch,
    [...new Set(clear)]
  );

  return getAIRuntimePublicSettings(
    input.repoRoot,
    input.organizationId
  );
}

function resolveOpenAIConfig(
  repoRoot: string,
  organizationId: string
) {
  return resolveOpenAIConfigFromValues(
    connectorVault(repoRoot).get(
      organizationId,
      OPENAI_COMPATIBLE_CREDENTIAL_ID
    )
  );
}

function resolveOpenAIConfigFromValues(
  values: Record<string, string>
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

function validateProposedSettings(
  values: Record<string, string>
): void {
  const mode = normalizeProviderMode(
    values.PROVIDER_MODE ||
    process.env.OEAP_AI_PROVIDER ||
    "auto"
  );
  const resolved = resolveOpenAIConfigFromValues(values);

  if (resolved.baseUrl) {
    validateOpenAICompatibleConfig({
      baseUrl: resolved.baseUrl,
      apiKey:
        resolved.config?.apiKey ||
        "validation-placeholder-key",
      model:
        resolved.model ||
        "validation-placeholder-model",
      timeoutMs: resolved.timeoutMs
    });
  }

  if (
    mode === "openai-compatible" &&
    resolved.complete &&
    resolved.config
  ) {
    validateOpenAICompatibleConfig(
      resolved.config
    );
  }
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

function safeProviderMode(
  value: unknown
): AIProviderMode {
  try {
    return normalizeProviderMode(value);
  } catch {
    return "auto";
  }
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
