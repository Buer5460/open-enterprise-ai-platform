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

export interface BusinessAnalysisInput {
  objective?: string;
  opportunity?: {
    title?: string;
    thesis?: string;
    markets?: string[];
    industries?: string[];
    evidence?: string[];
    risks?: string[];
  };
  market?: string;
  evidence?: string[];
  internalMetrics?: Record<string, unknown>;
}

export interface BusinessAnalysisOutput {
  executiveSummary: string;
  attractivenessScore: number;
  market: {
    description: string;
    regions: string[];
    evidence: string[];
  };
  customer: {
    primarySegment: string;
    painPoints: string[];
    buyerRoles: string[];
  };
  competition: {
    summary: string;
    differentiators: string[];
  };
  economics: {
    revenueDrivers: string[];
    costDrivers: string[];
    unknowns: string[];
  };
  regulation: {
    issues: string[];
    unknowns: string[];
  };
  recommendedICP: {
    regions: string[];
    industries: string[];
    companySize?: string;
    roles: string[];
    signals: string[];
  };
  entryPlan: string[];
  risks: string[];
  assumptions: string[];
  missingData: string[];
  evidence: string[];
  narrative?: string;
}

const inputSchema = {
  type: "object",
  properties: {
    objective: { type: "string" },
    opportunity: { type: "object" },
    market: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    internalMetrics: { type: "object" }
  }
};

const outputSchema = {
  type: "object",
  required: [
    "executiveSummary",
    "attractivenessScore",
    "market",
    "customer",
    "competition",
    "economics",
    "regulation",
    "recommendedICP",
    "entryPlan",
    "risks",
    "assumptions",
    "missingData",
    "evidence"
  ]
};

export const manifest = definePackage({
  schemaVersion: "1.0",
  id: "oeap.business-analysis",
  type: "agent",
  name: "business-analysis",
  displayName: "Business Analysis",
  description:
    "Evaluate an opportunity across market, customer, competition, economics, regulation and execution path.",
  version: "0.1.0",
  publisher: "oeap",
  license: "Apache-2.0",
  instructions:
    "Use external evidence and internal operating data separately; make assumptions and missing data explicit.",
  skills: ["oeap.ai-generate"],
  dependencies: [
    { package: "oeap.ai-generate", version: ">=0.0.1" }
  ],
  inputSchema,
  outputSchema,
  qualityChecks: [
    "Separate external evidence from internal operating assumptions.",
    "Do not invent market size, pricing or regulatory requirements.",
    "Provide a concrete entry plan and an ICP only when justified."
  ],
  tags: ["strategy", "market", "business-intelligence", "unit-economics"]
} satisfies OEAPAgentManifest);

export function normalizeBusinessAnalysisInput(
  value: unknown
): BusinessAnalysisInput {
  const record = asRecord(value);
  if (record.opportunity || record.internalMetrics || record.market) {
    return record as unknown as BusinessAnalysisInput;
  }

  const opportunities = asArray(record.opportunities)
    .map((item) => asRecord(item));
  const top = opportunities[0] ?? {};

  return {
    objective:
      asText(record.objective) ||
      asText(top.title) ||
      "Assess the highest-ranked commercial opportunity.",
    opportunity: {
      title: asOptionalText(top.title),
      thesis: asOptionalText(top.thesis),
      markets: asStringArray(top.markets),
      industries: asStringArray(top.industries),
      evidence: asStringArray(top.evidence),
      risks: asStringArray(top.risks)
    },
    evidence: asStringArray(top.evidence)
  };
}

export function buildBusinessAnalysisPrompt(
  input: BusinessAnalysisInput
): string {
  return createStructuredPrompt({
    role:
      "You are a commercial strategy analyst. You test whether an opportunity is economically and operationally attractive.",
    objective:
      input.objective?.trim() ||
      input.opportunity?.title ||
      "Evaluate the supplied business opportunity.",
    input,
    outputShape: {
      executiveSummary: "decision-oriented summary",
      attractivenessScore: 0,
      market: {
        description: "market description without invented market size",
        regions: ["region"],
        evidence: ["supplied evidence"]
      },
      customer: {
        primarySegment: "segment",
        painPoints: ["pain point"],
        buyerRoles: ["buyer role"]
      },
      competition: {
        summary: "competitive situation",
        differentiators: ["potential differentiator"]
      },
      economics: {
        revenueDrivers: ["driver"],
        costDrivers: ["driver"],
        unknowns: ["missing economic input"]
      },
      regulation: {
        issues: ["known issue only when supported"],
        unknowns: ["regulatory question to verify"]
      },
      recommendedICP: {
        regions: ["region"],
        industries: ["industry"],
        companySize: "optional",
        roles: ["buyer role"],
        signals: ["qualification signal"]
      },
      entryPlan: ["ordered action"],
      risks: ["risk"],
      assumptions: ["assumption"],
      missingData: ["data needed before committing capital"],
      evidence: ["evidence used"]
    },
    rules: [
      "Do not invent TAM, growth rates, competitor prices, legal requirements or internal unit economics.",
      "If a point is not supported, move it into assumptions or missingData.",
      "AttractivenessScore is an integer from 0 to 100."
    ]
  });
}

export function parseBusinessAnalysisOutput(
  generated: unknown,
  input: BusinessAnalysisInput
): BusinessAnalysisOutput {
  const parsed = asRecord(parseJsonValue(generated));
  const market = asRecord(parsed.market);
  const customer = asRecord(parsed.customer);
  const competition = asRecord(parsed.competition);
  const economics = asRecord(parsed.economics);
  const regulation = asRecord(parsed.regulation);
  const icp = asRecord(parsed.recommendedICP);
  const narrative = generatedText(generated);

  return {
    executiveSummary:
      asText(parsed.executiveSummary) ||
      narrative ||
      "Insufficient structured evidence for a complete business analysis.",
    attractivenessScore: clampScore(parsed.attractivenessScore),
    market: {
      description: asText(market.description),
      regions:
        asStringArray(market.regions).length > 0
          ? asStringArray(market.regions)
          : input.opportunity?.markets ?? [],
      evidence:
        asStringArray(market.evidence).length > 0
          ? asStringArray(market.evidence)
          : input.evidence ?? input.opportunity?.evidence ?? []
    },
    customer: {
      primarySegment: asText(customer.primarySegment),
      painPoints: asStringArray(customer.painPoints),
      buyerRoles: asStringArray(customer.buyerRoles)
    },
    competition: {
      summary: asText(competition.summary),
      differentiators: asStringArray(competition.differentiators)
    },
    economics: {
      revenueDrivers: asStringArray(economics.revenueDrivers),
      costDrivers: asStringArray(economics.costDrivers),
      unknowns: asStringArray(economics.unknowns)
    },
    regulation: {
      issues: asStringArray(regulation.issues),
      unknowns: asStringArray(regulation.unknowns)
    },
    recommendedICP: {
      regions: asStringArray(icp.regions),
      industries:
        asStringArray(icp.industries).length > 0
          ? asStringArray(icp.industries)
          : input.opportunity?.industries ?? [],
      companySize: asOptionalText(icp.companySize),
      roles: asStringArray(icp.roles),
      signals: asStringArray(icp.signals)
    },
    entryPlan: asStringArray(parsed.entryPlan),
    risks:
      asStringArray(parsed.risks).length > 0
        ? asStringArray(parsed.risks)
        : input.opportunity?.risks ?? [],
    assumptions: asStringArray(parsed.assumptions),
    missingData: asStringArray(parsed.missingData),
    evidence:
      asStringArray(parsed.evidence).length > 0
        ? asStringArray(parsed.evidence)
        : input.evidence ?? input.opportunity?.evidence ?? [],
    ...(narrative && Object.keys(parsed).length === 0
      ? { narrative }
      : {})
  };
}

export const agent: AgentExecutor<
  BusinessAnalysisInput,
  BusinessAnalysisOutput
> = {
  manifest,

  async execute(rawInput, context) {
    const input = normalizeBusinessAnalysisInput(rawInput);
    const generated = await context.runSkill<
      { prompt: string },
      { text: string }
    >(
      "oeap.ai-generate",
      { prompt: buildBusinessAnalysisPrompt(input) }
    );

    if (!generated.ok || !generated.output) {
      throw new Error(
        generated.error?.message ??
        "Business analysis failed"
      );
    }

    return parseBusinessAnalysisOutput(
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
