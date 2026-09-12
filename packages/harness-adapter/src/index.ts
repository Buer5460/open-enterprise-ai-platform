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
    return this.runCli([
      "--help"
    ]);
  }

  async runHeadless(
    prompt: string
  ): Promise<HarnessRunResult> {
    return this.runCli([
      "--profile",
      "headless",
      prompt
    ]);
  }

  private runCli(
    args: string[]
  ): Promise<HarnessRunResult> {
    const cliPath = resolve(
      this.config.harnessRoot,
      "apps/cli/lib/bin.js"
    );

    if (!existsSync(cliPath)) {
      throw new Error(
        `DeepSeek Harness CLI not built: ${cliPath}`
      );
    }

    return new Promise((resolvePromise) => {
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

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (exitCode) => {
        resolvePromise({
          ok: exitCode === 0,
          exitCode,
          stdout,
          stderr
        });
      });
    });
  }
}
