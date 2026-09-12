import {
  definePackage,
  type OEAPWorkflowManifest
} from "@oeap/package-spec";

import {
  workflowRuntime
} from "@oeap/workflow-engine";

export const manifest = definePackage({
  schemaVersion: "1.0",
  id: "oeap.growth-first-touch-workflow",
  type: "workflow",
  name: "growth-first-touch-workflow",
  displayName: "Growth First Touch Workflow",
  description:
    "Run the Growth Agent to perform first-round lead engagement.",
  version: "0.0.1",
  publisher: "oeap",

  steps: [
    {
      id: "growth-agent",
      type: "agent",
      target: "oeap.growth-agent"
    }
  ]
} satisfies OEAPWorkflowManifest);

export const workflow = {
  manifest
};

export const packageModule = {
  manifest,

  async activate() {
    workflowRuntime.register(workflow);
  },

  async deactivate() {
    workflowRuntime.unregister(manifest.id);
  }
};
