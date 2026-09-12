import type { OEAPBaseManifest } from "./base.js";

export interface OEAPConnectorManifest extends OEAPBaseManifest {
  type: "connector";

  transport:
    | "mcp"
    | "rest"
    | "graphql"
    | "sdk"
    | "local";

  provides: string[];

  configSchema?: Record<string, unknown>;
}
