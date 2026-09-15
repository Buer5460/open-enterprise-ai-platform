import assert from "node:assert/strict";

import {
  createStructuredPrompt,
  parseJsonValue
} from "../packages/structured-ai/dist/index.js";
import {
  manifest as companyManifest,
  skill as companySkill,
  buildCompanyResearchPrompt,
  parseCompanyResearchOutput
} from "../packages/official/company-research/dist/index.js";
import {
  manifest as leadManifest,
  agent as leadAgent,
  normalizeLeadGenerationInput,
  parseLeadGenerationOutput
} from "../packages/official/lead-generation/dist/index.js";
import {
  manifest as radarManifest,
  agent as radarAgent,
  parseOpportunityRadarOutput
} from "../packages/official/opportunity-radar/dist/index.js";
import {
  manifest as businessManifest,
  agent as businessAgent,
  normalizeBusinessAnalysisInput,
  parseBusinessAnalysisOutput
} from "../packages/official/business-analysis/dist/index.js";
import {
  manifest as investmentManifest,
  agent as investmentAgent,
  parseInvestmentAnalysisOutput
} from "../packages/official/investment-analysis/dist/index.js";
import {
  manifest as workflowManifest
} from "../packages/official/b2b-opportunity-workflow/dist/index.js";

const prompt = createStructuredPrompt({
  role: "Tester",
  objective: "Return structured data",
  input: { value: 1 },
  outputShape: { ok: true }
});
assert.ok(prompt.includes("Return one valid JSON value only"));
assert.deepEqual(
  parseJsonValue("```json\n{\"ok\":true}\n```"),
  { ok: true }
);

for (const manifest of [
  companyManifest,
  leadManifest,
  radarManifest,
  businessManifest,
  investmentManifest,
  workflowManifest
]) {
  assert.equal(manifest.version, "0.1.0");
  assert.ok(manifest.inputSchema, `${manifest.id} input schema missing`);
  assert.ok(manifest.outputSchema, `${manifest.id} output schema missing`);
  assert.ok(
    Array.isArray(manifest.qualityChecks) && manifest.qualityChecks.length > 0,
    `${manifest.id} quality checks missing`
  );
}

const companyInput = {
  companyName: "Example Travel",
  country: "Vietnam",
  evidence: ["Company website states it operates China tours."]
};
assert.ok(
  buildCompanyResearchPrompt(companyInput).includes("Example Travel")
);
const companyParsed = parseCompanyResearchOutput(
  {
    text: JSON.stringify({
      company: {
        name: "Example Travel",
        country: "Vietnam",
        summary: "Operates China tours."
      },
      facts: [
        {
          claim: "Operates China tours",
          evidence: "Company website states it operates China tours.",
          source: "company website"
        }
      ],
      risks: [],
      openQuestions: ["Decision maker unknown"],
      confidence: 82
    })
  },
  companyInput
);
assert.equal(companyParsed.confidence, 82);
assert.equal(companyParsed.facts.length, 1);

const executedCompany = await companySkill.execute(
  companyInput,
  {
    action: async () => ({
      status: "executed",
      output: {
        text: JSON.stringify({
          company: {
            name: "Example Travel",
            summary: "Evidence-backed summary"
          },
          facts: [],
          risks: [],
          openQuestions: [],
          confidence: 60
        })
      }
    })
  }
);
assert.equal(executedCompany.company.name, "Example Travel");

const normalizedBusiness = normalizeBusinessAnalysisInput({
  objective: "Find tourism payment opportunities",
  opportunities: [
    {
      title: "Tour operator payments",
      thesis: "Travel agencies need multi-rail checkout",
      markets: ["Vietnam"],
      industries: ["Travel"],
      evidence: ["Signal A"],
      risks: ["Regulation"]
    }
  ]
});
assert.equal(normalizedBusiness.opportunity.title, "Tour operator payments");

const businessOutput = parseBusinessAnalysisOutput(
  {
    text: JSON.stringify({
      executiveSummary: "Attractive if compliance is solved.",
      attractivenessScore: 76,
      market: {
        description: "Cross-border travel payments",
        regions: ["Vietnam"],
        evidence: ["Signal A"]
      },
      customer: {
        primarySegment: "Tour operators",
        painPoints: ["Payment acceptance"],
        buyerRoles: ["Founder", "Business Development"]
      },
      competition: {
        summary: "Fragmented",
        differentiators: ["Multi-rail orchestration"]
      },
      economics: {
        revenueDrivers: ["SaaS", "transaction share"],
        costDrivers: ["compliance"],
        unknowns: ["CAC"]
      },
      regulation: {
        issues: [],
        unknowns: ["local licensing"]
      },
      recommendedICP: {
        regions: ["Vietnam"],
        industries: ["Travel"],
        companySize: "5-200",
        roles: ["Founder"],
        signals: ["China tour products"]
      },
      entryPlan: ["Validate compliance", "Pilot with agencies"],
      risks: ["Regulation"],
      assumptions: [],
      missingData: ["CAC"],
      evidence: ["Signal A"]
    })
  },
  normalizedBusiness
);
assert.equal(businessOutput.attractivenessScore, 76);
assert.deepEqual(businessOutput.recommendedICP.regions, ["Vietnam"]);

const normalizedLead = normalizeLeadGenerationInput(businessOutput);
assert.deepEqual(normalizedLead.icp.regions, ["Vietnam"]);
assert.deepEqual(normalizedLead.icp.roles, ["Founder"]);

const leadParsed = parseLeadGenerationOutput(
  {
    text: JSON.stringify({
      icp: normalizedLead.icp,
      leads: [
        {
          companyName: "Agency A",
          country: "Vietnam",
          rationale: "Matches China-tour signal",
          score: 88,
          contactRoles: ["Founder"],
          evidence: ["Seed evidence"]
        },
        {
          companyName: "Agency B",
          country: "Vietnam",
          rationale: "Partial fit",
          score: 60,
          contactRoles: ["Business Development"],
          evidence: ["Seed evidence"]
        }
      ],
      warnings: []
    })
  },
  normalizedLead
);
assert.equal(leadParsed.leads[0].companyName, "Agency A");
assert.equal(leadParsed.leads[0].score, 88);

const radarParsed = parseOpportunityRadarOutput(
  {
    text: JSON.stringify({
      objective: "Find opportunities",
      opportunities: [
        {
          title: "Travel payments",
          thesis: "Signal supported",
          score: 90,
          markets: ["Vietnam"],
          industries: ["Travel"],
          evidence: ["Signal A"],
          risks: ["Regulation"],
          actions: ["Research companies"],
          targetCompanies: []
        }
      ],
      warnings: []
    })
  },
  {
    objective: "Find opportunities",
    signals: [
      {
        title: "Signal A",
        summary: "Travel agencies expand China products"
      }
    ]
  }
);
assert.equal(radarParsed.opportunities[0].score, 90);

const investmentParsed = parseInvestmentAnalysisOutput(
  {
    text: JSON.stringify({
      companyName: "Example Corp",
      stance: "watch",
      confidence: 65,
      investmentThesis: ["Recurring revenue"],
      bullCase: ["Margin expansion"],
      baseCase: ["Stable growth"],
      bearCase: ["Competition"],
      valuation: {
        assumptions: ["No price target without inputs"],
        missingInputs: ["FCF forecast"]
      },
      risks: ["Competition"],
      catalysts: ["New product"],
      monitoring: ["ARR growth"],
      evidence: ["Financial statement"],
      missingData: ["FCF forecast"]
    })
  },
  {
    companyName: "Example Corp",
    evidence: ["Financial statement"]
  }
);
assert.equal(investmentParsed.stance, "watch");
assert.equal(investmentParsed.confidence, 65);

const fakeGenerateContext = {
  runSkill: async (skillId, input) => {
    assert.equal(skillId, "oeap.ai-generate");
    assert.equal(typeof input.prompt, "string");
    return {
      ok: true,
      output: {
        text: JSON.stringify({
          objective: "Find opportunities",
          opportunities: [],
          warnings: ["No signals"]
        })
      }
    };
  }
};
const radarExecution = await radarAgent.execute(
  { objective: "Find opportunities", signals: [] },
  fakeGenerateContext
);
assert.deepEqual(radarExecution.opportunities, []);

const fakeBusinessContext = {
  runSkill: async () => ({
    ok: true,
    output: {
      text: JSON.stringify({
        executiveSummary: "Test",
        attractivenessScore: 50,
        market: {},
        customer: {},
        competition: {},
        economics: {},
        regulation: {},
        recommendedICP: {},
        entryPlan: [],
        risks: [],
        assumptions: [],
        missingData: [],
        evidence: []
      })
    }
  })
};
assert.equal(
  (await businessAgent.execute({ objective: "Test" }, fakeBusinessContext)).attractivenessScore,
  50
);

const fakeLeadContext = {
  runSkill: async () => ({
    ok: true,
    output: {
      text: JSON.stringify({
        icp: {},
        leads: [],
        warnings: ["No evidence"]
      })
    }
  })
};
assert.deepEqual(
  (await leadAgent.execute({ objective: "Test" }, fakeLeadContext)).leads,
  []
);

const fakeInvestmentContext = {
  runSkill: async () => ({
    ok: true,
    output: {
      text: JSON.stringify({
        companyName: "Example Corp",
        stance: "insufficient-data",
        confidence: 20,
        investmentThesis: [],
        bullCase: [],
        baseCase: [],
        bearCase: [],
        valuation: { assumptions: [], missingInputs: [] },
        risks: [],
        catalysts: [],
        monitoring: [],
        evidence: [],
        missingData: ["Financials"]
      })
    }
  })
};
assert.equal(
  (await investmentAgent.execute({ companyName: "Example Corp" }, fakeInvestmentContext)).stance,
  "insufficient-data"
);

assert.deepEqual(
  workflowManifest.steps.map((step) => step.target),
  [
    "oeap.opportunity-radar",
    "oeap.business-analysis",
    "oeap.lead-generation"
  ]
);

console.log("✅ OFFICIAL BUSINESS AGENTS TEST PASSED");
