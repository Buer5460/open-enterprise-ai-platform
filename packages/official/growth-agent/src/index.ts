import {
  definePackage,
  type OEAPAgentManifest
} from "@oeap/package-spec";

import {
  agentRuntime,
  type AgentExecutor
} from "@oeap/agent-runtime";

export interface GrowthAgentInput {
  leadId: string;
  profileUrl: string;
  message: string;
}

export interface GrowthAgentOutput {
  firstTouch: {
    like: string;
    follow: string;
    dm: string;
  };
}

export const manifest = definePackage({
  schemaVersion: "1.0",
  id: "oeap.growth-agent",
  type: "agent",
  name: "growth-agent",
  displayName: "Growth Agent",
  description:
    "Marketing and lead engagement agent.",
  version: "0.0.1",
  publisher: "oeap",

  instructions:
    "Execute marketing growth tasks using installed skills and platform capabilities.",

  skills: [
    "oeap.social-first-touch"
  ]
} satisfies OEAPAgentManifest);

export const agent: AgentExecutor<
  GrowthAgentInput,
  GrowthAgentOutput
> = {
  manifest,

  async execute(input, context) {
    const result = await context.runSkill<
      GrowthAgentInput,
      {
        like: string;
        follow: string;
        dm: string;
      }
    >(
      "oeap.social-first-touch",
      input
    );

    if (!result.ok || !result.output) {
      throw new Error(
        result.error?.message ??
        "Social first touch failed"
      );
    }

    return {
      firstTouch: result.output
    };
  }
};

export const packageModule = {
  manifest,

  async activate() {
    agentRuntime.register(agent);
  },

  async deactivate() {
    agentRuntime.unregister(manifest.id);
  }
};
