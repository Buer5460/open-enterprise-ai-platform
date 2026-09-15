import {
  definePackage,
  type OEAPSkillManifest
} from "@oeap/package-spec";
import {
  skillRuntime,
  type SkillExecutor
} from "@oeap/skill-runtime";
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

export interface CompanyResearchInput {
  companyName: string;
  website?: string;
  country?: string;
  researchQuestion?: string;
  evidence?: string[];
}

export interface CompanyResearchOutput {
  company: {
    name: string;
    website?: string;
    country?: string;
    summary: string;
  };
  facts: Array<{
    claim: string;
    evidence: string;
    source?: string;
  }>;
  risks: string[];
  openQuestions: string[];
  confidence: number;
  narrative?: string;
}

const inputSchema = {
  type: "object",
  required: ["companyName"],
  properties: {
    companyName: { type: "string", minLength: 1 },
    website: { type: "string" },
    country: { type: "string" },
    researchQuestion: { type: "string" },
    evidence: {
      type: "array",
      items: { type: "string" }
    }
  }
};

const outputSchema = {
  type: "object",
  required: [
    "company",
    "facts",
    "risks",
    "openQuestions",
    "confidence"
  ],
  properties: {
    company: { type: "object" },
    facts: { type: "array" },
    risks: { type: "array" },
    openQuestions: { type: "array" },
    confidence: { type: "number", minimum: 0, maximum: 100 }
  }
};

export const manifest = definePackage({
  schemaVersion: "1.0",
  id: "oeap.company-research",
  type: "skill",
  name: "company-research",
  displayName: "Company Research",
  description:
    "Produce evidence-aware company research without inventing unsupported facts.",
  version: "0.1.0",
  publisher: "oeap",
  license: "Apache-2.0",
  capabilities: [
    { id: "ai.generate" }
  ],
  permissions: [
    { id: "ai.generate", required: true }
  ],
  inputSchema,
  outputSchema,
  qualityChecks: [
    "Separate verified facts from assumptions.",
    "Never fabricate sources, contacts or financial figures.",
    "Expose missing information as open questions."
  ],
  execution: {
    mode: "hybrid",
    entry: "./dist/index.js"
  },
  tags: ["research", "company", "due-diligence"]
} satisfies OEAPSkillManifest);

export function buildCompanyResearchPrompt(
  input: CompanyResearchInput
): string {
  return createStructuredPrompt({
    role:
      "You are an enterprise company-research analyst. Distinguish evidence from inference.",
    objective:
      input.researchQuestion?.trim() ||
      `Research ${input.companyName} and identify commercially relevant facts, risks and information gaps.`,
    input,
    outputShape: {
      company: {
        name: input.companyName,
        website: input.website ?? "",
        country: input.country ?? "",
        summary: "concise evidence-aware summary"
      },
      facts: [
        {
          claim: "supported claim",
          evidence: "specific evidence from the supplied context",
          source: "source label or URL only when supplied"
        }
      ],
      risks: ["risk"],
      openQuestions: ["missing fact to verify"],
      confidence: 0
    },
    rules: [
      "Use only the supplied evidence and context as factual support.",
      "If the input contains no evidence, keep facts conservative and lower confidence.",
      "Confidence is an integer from 0 to 100."
    ]
  });
}

export function parseCompanyResearchOutput(
  generated: unknown,
  input: CompanyResearchInput
): CompanyResearchOutput {
  const parsed = asRecord(parseJsonValue(generated));
  const company = asRecord(parsed.company);

  const facts = asArray(parsed.facts)
    .map((item) => asRecord(item))
    .map((item) => ({
      claim: asText(item.claim),
      evidence: asText(item.evidence),
      source: asOptionalText(item.source)
    }))
    .filter((item) => item.claim && item.evidence);

  const fallbackNarrative = generatedText(generated);

  return {
    company: {
      name:
        asText(company.name) || input.companyName.trim(),
      website:
        asOptionalText(company.website) ||
        asOptionalText(input.website),
      country:
        asOptionalText(company.country) ||
        asOptionalText(input.country),
      summary:
        asText(company.summary) ||
        fallbackNarrative ||
        "No supported company summary was produced."
    },
    facts,
    risks: asStringArray(parsed.risks),
    openQuestions:
      asStringArray(parsed.openQuestions).length > 0
        ? asStringArray(parsed.openQuestions)
        : facts.length === 0
          ? ["Additional verifiable company evidence is required."]
          : [],
    confidence: clampScore(
      parsed.confidence,
      facts.length > 0 ? 55 : 20
    ),
    ...(fallbackNarrative && Object.keys(parsed).length === 0
      ? { narrative: fallbackNarrative }
      : {})
  };
}

export const skill: SkillExecutor<
  CompanyResearchInput,
  CompanyResearchOutput
> = {
  manifest,

  async execute(input, context) {
    if (!input.companyName?.trim()) {
      throw new Error("companyName is required");
    }

    const result = await context.action<
      { prompt: string },
      { text: string }
    >({
      action: "ai.generate",
      capability: "ai.generate",
      input: {
        prompt: buildCompanyResearchPrompt(input)
      }
    });

    if (result.status !== "executed" || !result.output) {
      throw new Error(
        result.error?.message ??
        "Company research generation failed"
      );
    }

    return parseCompanyResearchOutput(
      result.output,
      input
    );
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
