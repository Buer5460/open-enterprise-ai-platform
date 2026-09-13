import assert from "node:assert/strict";
import {
  AgentRuntime
} from "../packages/agent-runtime/dist/index.js";

const runtime = new AgentRuntime();

runtime.registerContextEnricher(
  "test-knowledge",
  async (request) => ({
    enterpriseKnowledgeContext:
      `knowledge:${request.workspaceId}`
  })
);

runtime.register({
  manifest: {
    schemaVersion: "1.0",
    id: "test.agent",
    type: "agent",
    name: "test-agent",
    version: "0.0.1",
    publisher: "test",
    instructions: "test",
    skills: []
  },
  async execute(_input, context) {
    return {
      knowledge:
        context.metadata?.enterpriseKnowledgeContext,
      workspaceId: context.workspaceId
    };
  }
});

const result = await runtime.run({
  agentId: "test.agent",
  input: {
    query: "customer policy"
  },
  workspaceId: "org_test"
});

assert.equal(result.ok, true);
assert.deepEqual(result.output, {
  knowledge: "knowledge:org_test",
  workspaceId: "org_test"
});

console.log("✅ AGENT CONTEXT ENRICHMENT TEST PASSED");
