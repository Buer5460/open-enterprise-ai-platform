import {
  definePackage,
  type OEAPWorkflowManifest
} from "@oeap/package-spec";
import {
  workflowRuntime
} from "@oeap/workflow-engine";

export const manifest = definePackage({
  schemaVersion: "1.0",
  id: "oeap.b2b-opportunity-workflow",
  type: "workflow",
  name: "b2b-opportunity-workflow",
  displayName: "B2B Opportunity Workflow",
  description:
    "Turn market signals into a ranked opportunity, business analysis and an evidence-aware B2B prospect pipeline.",
  version: "0.1.0",
  publisher: "oeap",
  license: "Apache-2.0",
  dependencies: [
    { package: "oeap.opportunity-radar", version: ">=0.1.0" },
    { package: "oeap.business-analysis", version: ">=0.1.0" },
    { package: "oeap.lead-generation", version: ">=0.1.0" }
  ],
  inputSchema: {
    type: "object",
    properties: {
      objective: { type: "string" },
      markets: { type: "array", items: { type: "string" } },
      industries: { type: "array", items: { type: "string" } },
      capabilities: { type: "array", items: { type: "string" } },
      signals: { type: "array", items: { type: "object" } }
    }
  },
  outputSchema: {
    type: "object",
    required: ["icp", "leads", "warnings"]
  },
  qualityChecks: [
    "Opportunity discovery must precede business analysis.",
    "Lead generation must consume the recommended ICP from business analysis.",
    "No workflow step may fabricate unsupported companies or contacts."
  ],
  steps: [
    {
      id: "opportunity-radar",
      type: "agent",
      target: "oeap.opportunity-radar"
    },
    {
      id: "business-analysis",
      type: "agent",
      target: "oeap.business-analysis"
    },
    {
      id: "lead-generation",
      type: "agent",
      target: "oeap.lead-generation"
    }
  ],
  tags: ["b2b", "opportunity", "strategy", "growth"]
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
