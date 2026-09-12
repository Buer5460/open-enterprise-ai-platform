import {
  definePackage,
  type OEAPSkillManifest
} from "@oeap/package-spec";

import {
  skillRuntime,
  type SkillExecutor
} from "@oeap/skill-runtime";

export interface SocialFirstTouchInput {
  leadId: string;
  profileUrl: string;
  message: string;
}

export interface SocialFirstTouchOutput {
  like: string;
  follow: string;
  dm: string;
}

export const manifest = definePackage({
  schemaVersion: "1.0",
  id: "oeap.social-first-touch",
  type: "skill",
  name: "social-first-touch",
  displayName: "Social First Touch",
  description: "Perform first-round social engagement for a lead.",
  version: "0.0.1",
  publisher: "oeap",
  capabilities: [
    { id: "social.like" },
    { id: "social.follow" },
    { id: "social.dm" }
  ],
  permissions: [
    { id: "social.like", required: true },
    { id: "social.follow", required: true },
    { id: "social.dm", required: true }
  ],
  execution: {
    mode: "code",
    entry: "./dist/index.js"
  }
} satisfies OEAPSkillManifest);

export const skill: SkillExecutor<
  SocialFirstTouchInput,
  SocialFirstTouchOutput
> = {
  manifest,

  async execute(input, context) {
    const like = await context.action({
      action: "social.like",
      capability: "social.like",
      input
    });

    const follow = await context.action({
      action: "social.follow",
      capability: "social.follow",
      input
    });

    const dm = await context.action({
      action: "social.dm",
      capability: "social.dm",
      input
    });

    return {
      like: like.status,
      follow: follow.status,
      dm: dm.status
    };
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
