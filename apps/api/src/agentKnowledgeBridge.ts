import {
  agentRuntime,
  type AgentRunRequest
} from "@oeap/agent-runtime";

import { KnowledgeStore } from "./knowledgeStore.js";
import { runtimePath } from "./runtimePaths.js";

const ENRICHER_ID = "oeap.enterprise-knowledge";

export function registerAgentKnowledgeBridge(input: {
  repoRoot: string;
}) {
  const knowledge = new KnowledgeStore(
    runtimePath(
      input.repoRoot,
      "knowledge",
      "knowledge.sqlite"
    )
  );

  agentRuntime.registerContextEnricher(
    ENRICHER_ID,
    async (request) => {
      const organizationId =
        request.workspaceId?.trim();
      if (!organizationId) {
        return undefined;
      }

      const query = agentKnowledgeQuery(request);
      if (!query) {
        return undefined;
      }

      const appId =
        typeof request.metadata?.appId === "string"
          ? request.metadata.appId
          : undefined;

      const context = knowledge.context({
        organizationId,
        appId,
        query,
        limit: 6,
        maxCharacters: 6000
      });

      if (!context.context) {
        return undefined;
      }

      return {
        enterpriseKnowledgeContext:
          context.context,
        enterpriseKnowledgeDocuments:
          context.matches.map((item: any) => ({
            id: item.documentId,
            title: item.title,
            source: item.source,
            score: item.score
          }))
      };
    }
  );
}

function agentKnowledgeQuery(
  request: AgentRunRequest<unknown>
): string | undefined {
  if (typeof request.metadata?.knowledgeQuery === "string") {
    const value = request.metadata.knowledgeQuery.trim();
    if (value) return value;
  }

  if (typeof request.input === "string") {
    const value = request.input.trim();
    return value || undefined;
  }

  if (
    request.input &&
    typeof request.input === "object"
  ) {
    const record = request.input as Record<string, unknown>;
    const values = [
      record.query,
      record.prompt,
      record.instruction,
      record.description,
      record.message,
      record.task,
      record.goal
    ]
      .filter(
        (value): value is string =>
          typeof value === "string" &&
          Boolean(value.trim())
      )
      .map((value) => value.trim());

    if (values.length > 0) {
      return values.join("\n").slice(0, 4000);
    }
  }

  return undefined;
}
