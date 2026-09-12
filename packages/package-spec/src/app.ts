import type { OEAPBaseManifest } from "./base.js";

export interface OEAPAppManifest extends OEAPBaseManifest {
  type: "app";

  packages?: string[];

  navigation?: Array<{
    id: string;
    label: string;
    path: string;
    icon?: string;
  }>;
}
