import {
  definePackage,
  type OEAPConnectorManifest
} from "@oeap/package-spec";

import {
  connectorRuntime,
  type ConnectorExecutor
} from "@oeap/connector-runtime";

import {
  DeepSeekHarnessAdapter
} from "@oeap/harness-adapter";

export const manifest = definePackage({
  schemaVersion: "1.0",
  id: "oeap.deepseek-harness",
  type: "connector",
  name: "deepseek-harness",
  displayName: "DeepSeek Harness",
  description:
    "DeepSeek Harness AI runtime connector for OEAP.",
  version: "0.0.1",
  publisher: "oeap",
  transport: "local",
  provides: [
    "ai.generate",
    "ai.task.run"
  ]
} satisfies OEAPConnectorManifest);

export interface DeepSeekHarnessConnectorConfig {
  harnessRoot: string;
  dshHome: string;
  workspaceRoot: string;
}

export function registerDeepSeekHarnessConnector(
  config: DeepSeekHarnessConnectorConfig
): void {
  if (
    connectorRuntime
      .listConnectors()
      .some((item) => item.id === "deepseek-harness")
  ) {
    return;
  }

  const adapter =
    new DeepSeekHarnessAdapter(config);

  const executor: ConnectorExecutor = {
    id: "deepseek-harness",
    packageId: manifest.id,
    version: manifest.version,
    transport: "local",

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

      const prompt =
        typeof input === "string"
          ? input
          : (
              input &&
              typeof input === "object" &&
              "prompt" in input &&
              typeof input.prompt === "string"
            )
            ? input.prompt
            : "";

      if (!prompt) {
        return {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            message: "prompt is required"
          }
        };
      }

      const result =
        await adapter.runHeadless(prompt);

      if (!result.ok) {
        return {
          ok: false,
          error: {
            code:
              result.exitCode === 124
                ? "HARNESS_TIMEOUT"
                : "HARNESS_EXECUTION_FAILED",
            message:
              result.stderr ||
              "DeepSeek Harness execution failed"
          }
        };
      }

      return {
        ok: true,
        output: {
          text: result.stdout.trim()
        },
        metadata: {
          provider: "deepseek-harness"
        }
      };
    }
  };

  connectorRuntime.register({
    executor,
    capabilities: [
      {
        id: "ai.generate",
        priority: 100,
        metadata: {
          provider: "deepseek-harness"
        }
      },
      {
        id: "ai.task.run",
        priority: 100,
        metadata: {
          provider: "deepseek-harness"
        }
      }
    ]
  });
}
