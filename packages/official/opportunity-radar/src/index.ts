import {
  definePackage,
  type OEAPAgentManifest
} from "@oeap/package-spec";
import {
  agentRuntime,
  type AgentExecutor
} from "@oeap/agent-runtime";
import {
  asArray,
  asOptionalText,
  asRecord,
  asStringArray,
  asText,
  clampScore,
  createStructuredPrompt,
  generatedText,
  parseJsonValue
} from "@oeap/structured-ai";

export interface OpportunitySignal {
  title: string;
  summary: string;
  source?: string;
  date?: string;
}

export interface OpportunityRadarInput {
  objective?: string;
  markets?: string[];
  industries?: string[];
  capabilities?: string[];
  signals?: OpportunitySignal[];
}

export interface OpportunityRadarOutput {
  objective: string;
  opportunities: Array<{
    title: string;
    thesis: string;
    score: number;
    markets: string[];
    industries: string[];
    evidence: string[];
    risks: string[];
    actions: string[];
    targetCompanies: string[];
    timeHorizon?: string;
  }>;
  warnings: string[];
  narrative?: string;
}

const inputSchema = {
  type: "object",
  properties: {
    objective: { type: "string" },
    markets: { type: "array", items: { type: "string" } },
    industries: { type: "array", items: { type: "string" } },
    capabilities: { type: "array", items: { type: "string" } },
    signals: { type: "array", items: { type: "object" } }
  }
};

const outputSchema = {
  type: "object",
  required: ["objective", "opportunities", "warnings"],
  properties: {
    objective: { type: "string" },
    opportunities: { type: "array" },
    warnings: { type: "array" }
  }
};

export const manifest = definePackage({
  schemaVersion: "1.0",
  id: "oeap.opportunity-radar",
  type: "agent",
  name: "opportunity-radar",
  displayName: "Opportunity Radar",
  description:
    "Score commercial opportunities from supplied market signals and enterprise capabilities.",
  version: "0.1.0",
  publisher: "oeap",
  license: "Apache-2.0",
  instructions:
    "Convert market signals into ranked opportunities, keeping evidence, risk and recommended actions explicit.",
  skills: ["oeap.ai-generate"],
  dependencies: [
    { package: "oeap.ai-generate", version: ">=0.0.1" }
  ],
  inputSchema,
  outputSchema,
  qualityChecks: [
    "Every opportunity must cite supplied signal evidence.",
    "Opportunity scores must balance strategic fit, evidence quality, urgency and execution risk.",
    "Do not treat speculation as confirmed market fact."
  ],
  tags: ["opportunity", "signals", "research", "business-intelligence"]
} satisfies OEAPAgentManifest);

export function buildOpportunityRadarPrompt(
  input: OpportunityRadarInput
): string {
  return createStructuredPrompt({
    role:
      "You are a commercial opportunity intelligence analyst. Rank opportunities only from the provided market signals and capabilities.",
    objective:
      input.objective?.trim() ||
      "Identify the highest-value commercial opportunities supported by the supplied signals.",
    input,
    outputShape: {
      objective: input.objective ?? "commercial opportunity discovery",
      opportunities: [
        {
          title: "opportunity",
          thesis: "why it matters",
          score: 0,
          markets: ["market"],
          industries: ["industry"],
          evidence: ["specific supplied signal"],
          risks: ["risk"],
          actions: ["next action"],
          targetCompanies: ["company only when supported by a signal"],
          timeHorizon: "optional urgency window"
        }
      ],
      warnings: ["data-quality limitation"]
    },
    rules: [
      "Do not create an opportunity without at least one evidence item from the supplied signals.",
      "If no adequate signals are supplied, return an empty opportunities array and a warning.",
      "Sort opportunities by score descending and use integer scores from 0 to 100."
    ]
  });
}

export function parseOpportunityRadarOutput(
  generated: unknown,
  input: OpportunityRadarInput
): OpportunityRadarOutput {
  const parsed = asRecord(parseJsonValue(generated));
  const opportunities = asArray(parsed.opportunities)
    .map((item) => asRecord(item))
    .map((item) => ({
      title: asText(item.title),
      thesis: asText(item.thesis),
      score: clampScore(item.score),
      markets: asStringArray(item.markets),
      industries: asStringArray(item.industries),
      evidence: asStringArray(item.evidence),
      risks: asStringArray(item.risks),
      actions: asStringArray(item.actions),
      targetCompanies: asStringArray(item.targetCompanies),
      timeHorizon: asOptionalText(item.timeHorizon)
    }))
    .filter((item) => item.title && item.evidence.length > 0)
    .sort((left, right) => right.score - left.score);

  const narrative = generatedText(generated);
  const warnings = asStringArray(parsed.warnings);

  return {
    objective:
      asText(parsed.objective) ||
      input.objective?.trim() ||
      "commercial opportunity discovery",
    opportunities,
    warnings:
      warnings.length > 0
        ? warnings
        : opportunities.length === 0
          ? ["No evidence-backed opportunities were produced from the supplied signals."]
          : [],
    ...(narrative && Object.keys(parsed).length === 0
      ? { narrative }
      : {})
  };
}

export const agent: AgentExecutor<
  OpportunityRadarInput,
  OpportunityRadarOutput
> = {
  manifest,

  async execute(input, context) {
    const generated = await context.runSkill<
      { prompt: string },
      { text: string }
    >(
      "oeap.ai-generate",
      { prompt: buildOpportunityRadarPrompt(input) }
    );

    if (!generated.ok || !generated.output) {
      throw new Error(
        generated.error?.message ??
        "Opportunity radar generation failed"
      );
    }

    return parseOpportunityRadarOutput(
      generated.output,
      input
    );
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
