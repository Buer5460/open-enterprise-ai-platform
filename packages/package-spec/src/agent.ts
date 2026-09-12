import type { OEAPBaseManifest } from "./base.js";

export interface OEAPAgentManifest extends OEAPBaseManifest {
  type: "agent";

  instructions?: string;

  skills?: string[];

  modelPolicy?: {
    preferred?: string[];
    fallback?: string[];
  };
}
