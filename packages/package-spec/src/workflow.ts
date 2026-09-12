import type { OEAPBaseManifest } from "./base.js";

export type OEAPWorkflowStepType =
  | "skill"
  | "agent"
  | "condition"
  | "approval"
  | "wait"
  | "parallel";

export interface OEAPWorkflowStep {
  id: string;
  type: OEAPWorkflowStepType;
  target?: string;
  config?: Record<string, unknown>;
}

export interface OEAPWorkflowManifest extends OEAPBaseManifest {
  type: "workflow";
  steps: OEAPWorkflowStep[];
}
