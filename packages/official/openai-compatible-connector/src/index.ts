import {
  definePackage,
  type OEAPConnectorManifest
} from "@oeap/package-spec";
import {
  connectorRuntime,
  type ConnectorExecutor
} from "@oeap/connector-runtime";

export const manifest = definePackage({
  schemaVersion: "1.0",
  id: "oeap.openai-compatible",
  type: "connector",
  name: "openai-compatible",
  displayName: "OpenAI-Compatible AI",
  description:
    "Server-side connector for OpenAI-compatible chat completion APIs.",
  version: "0.0.1",
  publisher: "oeap",
  transport: "rest",
  provides: [
    "ai.generate",
    "ai.task.run"
  ]
} satisfies OEAPConnectorManifest);

export interface OpenAICompatibleConnectorConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  priority?: number;
  userAgent?: string;
}

export function registerOpenAICompatibleConnector(
  config: OpenAICompatibleConnectorConfig
): void {
  if (
    connectorRuntime
      .listConnectors()
      .some((item) => item.id === "openai-compatible")
  ) {
    return;
  }

  const normalized = validateConfig(config);

  const executor: ConnectorExecutor = {
    id: "openai-compatible",
    packageId: manifest.id,
    version: manifest.version,
    transport: "rest",

    async execute(capability, input) {
      if (
        capability !== "ai.generate" &&
        capability !== "ai.task.run"
      ) {
        return {
          ok: false,
          error: {
            code: "UNSUPPORTED_CAPABILITY",
            message:
              `Unsupported capability: ${capability}`
          }
        };
      }

      const prompt = extractPrompt(input);
      if (!prompt) {
        return {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "prompt is required"
          }
        };
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          normalized.timeoutMs
        );

        try {
          const response = await fetch(
            normalized.endpoint,
            {
              method: "POST",
              signal: controller.signal,
              headers: {
                "Authorization":
                  `Bearer ${normalized.apiKey}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": normalized.userAgent
              },
              body: JSON.stringify({
                model: normalized.model,
                messages: [
                  {
                    role: "user",
                    content: prompt
                  }
                ]
              })
            }
          );

          const payload = await response
            .json()
            .catch(() => ({})) as any;

          if (!response.ok) {
            return {
              ok: false,
              error: {
                code: "AI_PROVIDER_HTTP_ERROR",
                message:
                  providerErrorMessage(
                    payload,
                    response.status
                  )
              },
              metadata: {
                provider: "openai-compatible",
                status: response.status,
                model: normalized.model
              }
            };
          }

          const text = extractResponseText(payload);
          if (!text) {
            return {
              ok: false,
              error: {
                code: "AI_PROVIDER_INVALID_RESPONSE",
                message:
                  "AI provider returned no completion text"
              },
              metadata: {
                provider: "openai-compatible",
                model: normalized.model
              }
            };
          }

          return {
            ok: true,
            output: { text },
            metadata: {
              provider: "openai-compatible",
              model: normalized.model,
              requestId:
                response.headers.get("x-request-id") ??
                response.headers.get("request-id") ??
                undefined
            }
          };
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        const aborted =
          error instanceof Error &&
          error.name === "AbortError";

        return {
          ok: false,
          error: {
            code: aborted
              ? "AI_PROVIDER_TIMEOUT"
              : "AI_PROVIDER_UNREACHABLE",
            message: aborted
              ? "AI provider request timed out"
              : "AI provider is unreachable"
          },
          metadata: {
            provider: "openai-compatible",
            model: normalized.model
          }
        };
      }
    }
  };

  connectorRuntime.register({
    executor,
    capabilities: [
      {
        id: "ai.generate",
        priority: normalized.priority,
        metadata: {
          provider: "openai-compatible",
          model: normalized.model
        }
      },
      {
        id: "ai.task.run",
        priority: normalized.priority,
        metadata: {
          provider: "openai-compatible",
          model: normalized.model
        }
      }
    ]
  });
}

function validateConfig(
  config: OpenAICompatibleConnectorConfig
) {
  const baseUrl = config.baseUrl.trim();
  const apiKey = config.apiKey.trim();
  const model = config.model.trim();

  if (!baseUrl || !apiKey || !model) {
    throw new Error(
      "OpenAI-compatible provider requires baseUrl, apiKey and model"
    );
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(
      "OpenAI-compatible baseUrl must be a valid URL"
    );
  }

  const local =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "::1";

  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(
      "OpenAI-compatible baseUrl must use HTTPS (HTTP is allowed only for localhost)"
    );
  }

  url.search = "";
  url.hash = "";
  const endpoint =
    `${url.toString().replace(/\/+$/, "")}/chat/completions`;

  const requestedTimeout =
    Number(config.timeoutMs ?? 120_000);
  const timeoutMs =
    Number.isFinite(requestedTimeout)
      ? Math.min(
          Math.max(Math.trunc(requestedTimeout), 5_000),
          300_000
        )
      : 120_000;

  return {
    endpoint,
    apiKey,
    model,
    timeoutMs,
    priority:
      Number.isFinite(config.priority)
        ? Number(config.priority)
        : 200,
    userAgent:
      config.userAgent?.trim() ||
      "OEAP-OpenAI-Compatible/0.0.1"
  };
}

function extractPrompt(input: unknown): string {
  if (typeof input === "string") {
    return input.trim();
  }

  if (
    input &&
    typeof input === "object" &&
    "prompt" in input &&
    typeof (input as { prompt?: unknown }).prompt === "string"
  ) {
    return (input as { prompt: string }).prompt.trim();
  }

  return "";
}

function extractResponseText(payload: any): string {
  const content =
    payload?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          typeof part.text === "string"
        ) {
          return part.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (typeof payload?.output_text === "string") {
    return payload.output_text.trim();
  }

  return "";
}

function providerErrorMessage(
  payload: any,
  status: number
): string {
  const message =
    typeof payload?.error?.message === "string"
      ? payload.error.message.trim()
      : "";

  if (message) {
    return `AI provider rejected the request (${status}): ${message.slice(0, 500)}`;
  }

  return `AI provider rejected the request with HTTP ${status}`;
}
