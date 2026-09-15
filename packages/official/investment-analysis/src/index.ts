import {
  definePackage,
  type OEAPAgentManifest
} from "@oeap/package-spec";
import {
  agentRuntime,
  type AgentExecutor
} from "@oeap/agent-runtime";
import {
  asOptionalText,
  asRecord,
  asStringArray,
  asText,
  clampScore,
  createStructuredPrompt,
  generatedText,
  parseJsonValue
} from "@oeap/structured-ai";

export interface InvestmentAnalysisInput {
  companyName: string;
  ticker?: string;
  thesis?: string;
  financials?: Record<string, unknown>;
  valuationInputs?: Record<string, unknown>;
  evidence?: string[];
  marketData?: Record<string, unknown>;
}

export interface InvestmentAnalysisOutput {
  companyName: string;
  stance: "explore" | "watch" | "avoid" | "insufficient-data";
  confidence: number;
  investmentThesis: string[];
  bullCase: string[];
  baseCase: string[];
  bearCase: string[];
  valuation: {
    method?: string;
    range?: string;
    assumptions: string[];
    missingInputs: string[];
  };
  risks: string[];
  catalysts: string[];
  monitoring: string[];
  evidence: string[];
  missingData: string[];
  narrative?: string;
}

const inputSchema = {
  type: "object",
  required: ["companyName"],
  properties: {
    companyName: { type: "string", minLength: 1 },
    ticker: { type: "string" },
    thesis: { type: "string" },
    financials: { type: "object" },
    valuationInputs: { type: "object" },
    evidence: { type: "array", items: { type: "string" } },
    marketData: { type: "object" }
  }
};

const outputSchema = {
  type: "object",
  required: [
    "companyName",
    "stance",
    "confidence",
    "investmentThesis",
    "bullCase",
    "baseCase",
    "bearCase",
    "valuation",
    "risks",
    "catalysts",
    "monitoring",
    "evidence",
    "missingData"
  ]
};

export const manifest = definePackage({
  schemaVersion: "1.0",
  id: "oeap.investment-analysis",
  type: "agent",
  name: "investment-analysis",
  displayName: "Investment Analysis",
  description:
    "Create a reviewable investment memo from supplied financial, market and research evidence.",
  version: "0.1.0",
  publisher: "oeap",
  license: "Apache-2.0",
  instructions:
    "Treat professional financial data as the source of truth, make valuation assumptions explicit and never invent missing figures.",
  skills: ["oeap.ai-generate"],
  dependencies: [
    { package: "oeap.ai-generate", version: ">=0.0.1" }
  ],
  inputSchema,
  outputSchema,
  qualityChecks: [
    "No fabricated financial metrics or valuation inputs.",
    "Separate bull, base and bear cases.",
    "List missing data and monitoring events before drawing a stance."
  ],
  tags: ["investment", "valuation", "risk", "research"]
} satisfies OEAPAgentManifest);

export function buildInvestmentAnalysisPrompt(
  input: InvestmentAnalysisInput
): string {
  return createStructuredPrompt({
    role:
      "You are an institutional investment-research analyst. Your memo must be reproducible from supplied evidence and financial data.",
    objective:
      input.thesis?.trim() ||
      `Assess ${input.companyName} as an investment research candidate.`,
    input,
    outputShape: {
      companyName: input.companyName,
      stance: "explore | watch | avoid | insufficient-data",
      confidence: 0,
      investmentThesis: ["thesis point"],
      bullCase: ["upside condition"],
      baseCase: ["base assumption"],
      bearCase: ["downside condition"],
      valuation: {
        method: "only if supported by inputs",
        range: "only if calculable from supplied inputs",
        assumptions: ["valuation assumption"],
        missingInputs: ["missing valuation input"]
      },
      risks: ["risk"],
      catalysts: ["catalyst"],
      monitoring: ["future metric or event"],
      evidence: ["supplied evidence used"],
      missingData: ["critical missing information"]
    },
    rules: [
      "Do not provide a price target or valuation range unless the supplied inputs support calculation.",
      "Use insufficient-data when the evidence cannot support a defensible research stance.",
      "Confidence is an integer from 0 to 100."
    ]
  });
}

export function parseInvestmentAnalysisOutput(
  generated: unknown,
  input: InvestmentAnalysisInput
): InvestmentAnalysisOutput {
  const parsed = asRecord(parseJsonValue(generated));
  const valuation = asRecord(parsed.valuation);
  const narrative = generatedText(generated);
  const rawStance = asText(parsed.stance);
  const stance: InvestmentAnalysisOutput["stance"] =
    rawStance === "explore" ||
    rawStance === "watch" ||
    rawStance === "avoid" ||
    rawStance === "insufficient-data"
      ? rawStance
      : "insufficient-data";

  return {
    companyName:
      asText(parsed.companyName) || input.companyName.trim(),
    stance,
    confidence: clampScore(parsed.confidence),
    investmentThesis: asStringArray(parsed.investmentThesis),
    bullCase: asStringArray(parsed.bullCase),
    baseCase: asStringArray(parsed.baseCase),
    bearCase: asStringArray(parsed.bearCase),
    valuation: {
      method: asOptionalText(valuation.method),
      range: asOptionalText(valuation.range),
      assumptions: asStringArray(valuation.assumptions),
      missingInputs: asStringArray(valuation.missingInputs)
    },
    risks: asStringArray(parsed.risks),
    catalysts: asStringArray(parsed.catalysts),
    monitoring: asStringArray(parsed.monitoring),
    evidence:
      asStringArray(parsed.evidence).length > 0
        ? asStringArray(parsed.evidence)
        : input.evidence ?? [],
    missingData:
      asStringArray(parsed.missingData).length > 0
        ? asStringArray(parsed.missingData)
        : Object.keys(input.financials ?? {}).length === 0
          ? ["Structured financial statements and valuation inputs are missing."]
          : [],
    ...(narrative && Object.keys(parsed).length === 0
      ? { narrative }
      : {})
  };
}

export const agent: AgentExecutor<
  InvestmentAnalysisInput,
  InvestmentAnalysisOutput
> = {
  manifest,

  async execute(input, context) {
    if (!input.companyName?.trim()) {
      throw new Error("companyName is required");
    }

    const generated = await context.runSkill<
      { prompt: string },
      { text: string }
    >(
      "oeap.ai-generate",
      { prompt: buildInvestmentAnalysisPrompt(input) }
    );

    if (!generated.ok || !generated.output) {
      throw new Error(
        generated.error?.message ??
        "Investment analysis failed"
      );
    }

    return parseInvestmentAnalysisOutput(
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
