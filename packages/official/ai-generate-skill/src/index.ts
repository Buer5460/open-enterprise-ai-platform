import {
  definePackage,
  type OEAPSkillManifest
} from "@oeap/package-spec";

import {
  skillRuntime,
  type SkillExecutor
} from "@oeap/skill-runtime";

export interface AIGenerateInput {
  prompt: string;
}

export interface AIGenerateOutput {
  text: string;
}

export const manifest = definePackage({
  schemaVersion: "1.0",
  id: "oeap.ai-generate",
  type: "skill",
  name: "ai-generate",
  displayName: "AI Generate",
  description:
    "Generate text through any installed provider of the ai.generate capability.",
  version: "0.0.1",
  publisher: "oeap",
  capabilities: [
    { id: "ai.generate" }
  ],
  permissions: [
    { id: "ai.generate", required: true }
  ],
  execution: {
    mode: "hybrid",
    entry: "./dist/index.js"
  }
} satisfies OEAPSkillManifest);

export const skill: SkillExecutor<
  AIGenerateInput,
  AIGenerateOutput
> = {
  manifest,

  async execute(input, context) {
    const preferredProvider =
      typeof context.metadata?.preferredProvider === "string"
        ? context.metadata.preferredProvider.trim()
        : undefined;

    const result = await context.action<
      AIGenerateInput,
      AIGenerateOutput
    >({
      action: "ai.generate",
      capability: "ai.generate",
      input,
      preferredProvider:
        preferredProvider || undefined
    });

    if (
      result.status !== "executed" ||
      !result.output
    ) {
      throw new Error(
        result.error?.message ??
        "AI generation failed"
      );
    }

    return result.output;
  }
};

export const packageModule = {
  manifest,

  async activate() {
    skillRuntime.register(skill);
  },

  async deactivate() {
    skillRuntime.unregister(manifest.id);
  }
};
