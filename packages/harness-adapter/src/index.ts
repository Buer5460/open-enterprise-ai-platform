import {
  spawn
} from "node:child_process";

import {
  existsSync
} from "node:fs";

import {
  resolve
} from "node:path";

export interface HarnessAdapterConfig {
  harnessRoot: string;
  dshHome: string;
  workspaceRoot: string;
  timeoutMs?: number;
  healthTimeoutMs?: number;
}

export interface HarnessRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export class DeepSeekHarnessAdapter {
  constructor(
    private readonly config: HarnessAdapterConfig
  ) {}

  async healthCheck(): Promise<HarnessRunResult> {
    return this.runCli(
      ["--help"],
      boundedTimeout(
        this.config.healthTimeoutMs,
        10_000,
        1_000,
        30_000
      )
    );
  }

  async runHeadless(
    prompt: string
  ): Promise<HarnessRunResult> {
    return this.runCli(
      [
        "--profile",
        "headless",
        prompt
      ],
      boundedTimeout(
        this.config.timeoutMs,
        environmentTimeout(),
        5_000,
        10 * 60_000
      )
    );
  }

  private runCli(
    args: string[],
    timeoutMs: number
  ): Promise<HarnessRunResult> {
    const cliPath = resolve(
      this.config.harnessRoot,
      "apps/cli/lib/bin.js"
    );

    if (!existsSync(cliPath)) {
      return Promise.resolve({
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: `DeepSeek Harness CLI not built: ${cliPath}`
      });
    }

    return new Promise((resolvePromise) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = (result: HarnessRunResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        resolvePromise(result);
      };

      const child = spawn(
        process.execPath,
        [
          cliPath,
          ...args
        ],
        {
          cwd: this.config.workspaceRoot,
          env: {
            ...process.env,
            DSH_HOME: this.config.dshHome
          }
        }
      );

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", (error) => {
        finish({
          ok: false,
          exitCode: null,
          stdout,
          stderr: [
            stderr,
            error.message
          ].filter(Boolean).join("\n")
        });
      });

      child.on("close", (exitCode) => {
        finish({
          ok: exitCode === 0,
          exitCode,
          stdout,
          stderr
        });
      });

      const timeoutTimer = setTimeout(() => {
        stderr = [
          stderr,
          `DeepSeek Harness timed out after ${timeoutMs}ms`
        ].filter(Boolean).join("\n");

        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
          if (child.exitCode === null) {
            child.kill("SIGKILL");
          }
        }, 2_000);

        finish({
          ok: false,
          exitCode: 124,
          stdout,
          stderr
        });
      }, timeoutMs);
    });
  }
}

function environmentTimeout(): number {
  const value = Number(
    process.env.OEAP_AI_TIMEOUT_MS
  );
  return Number.isFinite(value) && value > 0
    ? value
    : 120_000;
}

function boundedTimeout(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const requested =
    Number.isFinite(value) && Number(value) > 0
      ? Number(value)
      : fallback;
  return Math.min(
    Math.max(Math.round(requested), minimum),
    maximum
  );
}
