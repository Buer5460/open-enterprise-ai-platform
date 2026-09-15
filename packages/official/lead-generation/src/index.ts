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

export interface LeadGenerationInput {
  objective?: string;
  icp?: {
    regions?: string[];
    industries?: string[];
    companySize?: string;
    signals?: string[];
    roles?: string[];
  };
  limit?: number;
  seedCompanies?: string[];
  evidence?: string[];
}

export interface LeadGenerationOutput {
  icp: {
    regions: string[];
    industries: string[];
    companySize?: string;
    signals: string[];
    roles: string[];
  };
  leads: Array<{
    companyName: string;
    website?: string;
    country?: string;
    rationale: string;
    score: number;
    contactRoles: string[];
    evidence: string[];
  }>;
  warnings: string[];
  narrative?: string;
}

const inputSchema = {
  type: "object",
  properties: {
    objective: { type: "string" },
    icp: { type: "object" },
    limit: { type: "integer", minimum: 1, maximum: 200 },
    seedCompanies: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } }
  }
};

const outputSchema = {
  type: "object",
  required: ["icp", "leads", "warnings"],
  properties: {
    icp: { type: "object" },
    leads: { type: "array" },
    warnings: { type: "array" }
  }
};

export const manifest = definePackage({
  schemaVersion: "1.0",
  id: "oeap.lead-generation",
  type: "agent",
  name: "lead-generation",
  displayName: "Lead Generation",
  description:
    "Turn an ICP and evidence into a ranked B2B prospect pipeline without fabricating contact data.",
  version: "0.1.0",
  publisher: "oeap",
  license: "Apache-2.0",
  instructions:
    "Define an ICP, identify candidate companies from supplied evidence or connected context, score them and expose missing verification.",
  skills: ["oeap.ai-generate", "oeap.company-research"],
  dependencies: [
    { package: "oeap.ai-generate", version: ">=0.0.1" },
    { package: "oeap.company-research", version: ">=0.1.0", optional: true }
  ],
  inputSchema,
  outputSchema,
  qualityChecks: [
    "Never invent emails or phone numbers.",
    "Keep evidence attached to each lead.",
    "Scores must be explainable from ICP fit and supplied signals."
  ],
  tags: ["sales", "growth", "leads", "b2b"]
} satisfies OEAPAgentManifest);

export function normalizeLeadGenerationInput(
  value: unknown
): LeadGenerationInput {
  const record = asRecord(value);

  if (record.icp) {
    return record as unknown as LeadGenerationInput;
  }

  const recommendedICP = asRecord(record.recommendedICP);
  const customer = asRecord(record.customer);
  const market = asRecord(record.market);

  return {
    objective:
      asText(record.executiveSummary) ||
      asText(record.objective) ||
      "Find organizations that fit the recommended go-to-market path.",
    icp: {
      regions:
        asStringArray(recommendedICP.regions).length > 0
          ? asStringArray(recommendedICP.regions)
          : asStringArray(market.regions),
      industries: asStringArray(recommendedICP.industries),
      companySize: asOptionalText(recommendedICP.companySize),
      signals: asStringArray(recommendedICP.signals),
      roles:
        asStringArray(recommendedICP.roles).length > 0
          ? asStringArray(recommendedICP.roles)
          : asStringArray(customer.buyerRoles)
    },
    evidence: asStringArray(record.evidence),
    limit: 25
  };
}

export function buildLeadGenerationPrompt(
  input: LeadGenerationInput
): string {
  const limit = Math.max(
    1,
    Math.min(200, Math.round(input.limit ?? 25))
  );

  return createStructuredPrompt({
    role:
      "You are a B2B lead-generation analyst. You rank companies by explicit ICP fit and evidence quality.",
    objective:
      input.objective?.trim() ||
      "Build a high-quality prospect list from the supplied ICP and evidence.",
    input: {
      ...input,
      limit
    },
    outputShape: {
      icp: {
        regions: ["region"],
        industries: ["industry"],
        companySize: "optional size range",
        signals: ["buying signal"],
        roles: ["target role"]
      },
      leads: [
        {
          companyName: "company",
          website: "only when supported",
          country: "only when supported",
          rationale: "why the company fits",
          score: 0,
          contactRoles: ["role, not invented person"],
          evidence: ["supporting supplied signal"]
        }
      ],
      warnings: ["data-quality limitation"]
    },
    rules: [
      `Return at most ${limit} leads.`,
      "Do not create personal names, emails or phone numbers unless they already appear in supplied evidence.",
      "If the supplied context cannot support a real company candidate, return fewer leads and explain the limitation in warnings.",
      "Score each lead from 0 to 100."
    ]
  });
}

export function parseLeadGenerationOutput(
  generated: unknown,
  input: LeadGenerationInput
): LeadGenerationOutput {
  const parsed = asRecord(parseJsonValue(generated));
  const parsedIcp = asRecord(parsed.icp);
  const sourceIcp = input.icp ?? {};
  const limit = Math.max(
    1,
    Math.min(200, Math.round(input.limit ?? 25))
  );

  const leads = asArray(parsed.leads)
    .map((item) => asRecord(item))
    .map((item) => ({
      companyName: asText(item.companyName),
      website: asOptionalText(item.website),
      country: asOptionalText(item.country),
      rationale: asText(item.rationale),
      score: clampScore(item.score),
      contactRoles: asStringArray(item.contactRoles),
      evidence: asStringArray(item.evidence)
    }))
    .filter((item) => item.companyName)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  const narrative = generatedText(generated);
  const warnings = asStringArray(parsed.warnings);

  return {
    icp: {
      regions:
        asStringArray(parsedIcp.regions).length > 0
          ? asStringArray(parsedIcp.regions)
          : sourceIcp.regions ?? [],
      industries:
        asStringArray(parsedIcp.industries).length > 0
          ? asStringArray(parsedIcp.industries)
          : sourceIcp.industries ?? [],
      companySize:
        asOptionalText(parsedIcp.companySize) ||
        sourceIcp.companySize,
      signals:
        asStringArray(parsedIcp.signals).length > 0
          ? asStringArray(parsedIcp.signals)
          : sourceIcp.signals ?? [],
      roles:
        asStringArray(parsedIcp.roles).length > 0
          ? asStringArray(parsedIcp.roles)
          : sourceIcp.roles ?? []
    },
    leads,
    warnings:
      warnings.length > 0
        ? warnings
        : leads.length === 0
          ? ["No verifiable lead candidates were produced from the supplied context."]
          : [],
    ...(narrative && Object.keys(parsed).length === 0
      ? { narrative }
      : {})
  };
}

export const agent: AgentExecutor<
  LeadGenerationInput,
  LeadGenerationOutput
> = {
  manifest,

  async execute(rawInput, context) {
    const input = normalizeLeadGenerationInput(rawInput);
    const generated = await context.runSkill<
      { prompt: string },
      { text: string }
    >(
      "oeap.ai-generate",
      { prompt: buildLeadGenerationPrompt(input) }
    );

    if (!generated.ok || !generated.output) {
      throw new Error(
        generated.error?.message ??
        "Lead generation failed"
      );
    }

    return parseLeadGenerationOutput(
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
