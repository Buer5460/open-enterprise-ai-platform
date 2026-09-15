import type { OEAPBaseManifest } from "./base.js";

export interface OEAPAgentManifest extends OEAPBaseManifest {
  type: "agent";

  instructions?: string;

  skills?: string[];

  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  qualityChecks?: string[];

  modelPolicy?: {
    preferred?: string[];
    fallback?: string[];
  };
}
