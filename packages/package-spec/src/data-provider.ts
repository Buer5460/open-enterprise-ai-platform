import type { OEAPBaseManifest } from "./base.js";

export interface OEAPDataProviderManifest extends OEAPBaseManifest {
  type: "data-provider";

  provides: string[];

  dataCategories?: string[];

  configSchema?: Record<string, unknown>;
}
