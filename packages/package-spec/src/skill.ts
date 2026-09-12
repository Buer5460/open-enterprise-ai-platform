import type { OEAPBaseManifest } from "./base.js";

export interface OEAPSkillManifest extends OEAPBaseManifest {
  type: "skill";

  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;

  execution?: {
    mode: "prompt" | "code" | "hybrid";
    entry?: string;
  };

  qualityChecks?: string[];
}
