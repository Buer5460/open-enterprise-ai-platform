export * from "./base.js";
export * from "./skill.js";
export * from "./agent.js";
export * from "./workflow.js";
export * from "./connector.js";
export * from "./data-provider.js";
export * from "./app.js";
export * from "./compatibility.js";
export * from "./marketplace.js";
export * from "./universal-action.js";

import type { OEAPSkillManifest } from "./skill.js";
import type { OEAPAgentManifest } from "./agent.js";
import type { OEAPWorkflowManifest } from "./workflow.js";
import type { OEAPConnectorManifest } from "./connector.js";
import type { OEAPDataProviderManifest } from "./data-provider.js";
import type { OEAPAppManifest } from "./app.js";

export type OEAPPackageManifest =
  | OEAPSkillManifest
  | OEAPAgentManifest
  | OEAPWorkflowManifest
  | OEAPConnectorManifest
  | OEAPDataProviderManifest
  | OEAPAppManifest;

export function definePackage<T extends OEAPPackageManifest>(
  manifest: T
): T {
  return manifest;
}
