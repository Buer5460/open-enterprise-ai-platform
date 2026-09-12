export type PermissionEffect =
  | "allow"
  | "deny"
  | "approval";

export type SubjectType =
  | "user"
  | "agent"
  | "workflow"
  | "package"
  | "system";

export interface PermissionSubject {
  type: SubjectType;
  id: string;
}

export interface PermissionRequest {
  subject: PermissionSubject;

  action: string;

  resource?: string;

  workspaceId?: string;

  metadata?: Record<string, unknown>;
}

export interface PermissionRule {
  id: string;

  effect: PermissionEffect;

  actions: string[];

  subjects?: string[];

  resources?: string[];

  workspaceIds?: string[];

  priority?: number;

  reason?: string;
}

export interface PermissionDecision {
  effect: PermissionEffect;

  allowed: boolean;

  requiresApproval: boolean;

  matchedRuleIds: string[];

  reason?: string;
}

function matchesPattern(
  value: string,
  pattern: string
): boolean {
  if (pattern === "*") {
    return true;
  }

  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -1);
    return value.startsWith(prefix);
  }

  return value === pattern;
}

function matchesAny(
  value: string,
  patterns?: string[]
): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }

  return patterns.some((pattern) =>
    matchesPattern(value, pattern)
  );
}

export class PermissionEngine {
  private readonly rules = new Map<string, PermissionRule>();

  registerRule(rule: PermissionRule): void {
    if (this.rules.has(rule.id)) {
      throw new Error(
        `Permission rule already exists: ${rule.id}`
      );
    }

    this.rules.set(rule.id, rule);
  }

  unregisterRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  evaluate(
    request: PermissionRequest
  ): PermissionDecision {
    const subjectKey =
      `${request.subject.type}:${request.subject.id}`;

    const matching = [...this.rules.values()]
      .filter((rule) => {
        if (!matchesAny(request.action, rule.actions)) {
          return false;
        }

        if (!matchesAny(subjectKey, rule.subjects)) {
          return false;
        }

        if (
          request.resource &&
          !matchesAny(request.resource, rule.resources)
        ) {
          return false;
        }

        if (
          rule.workspaceIds &&
          rule.workspaceIds.length > 0 &&
          (!request.workspaceId ||
            !rule.workspaceIds.includes(request.workspaceId))
        ) {
          return false;
        }

        return true;
      })
      .sort(
        (a, b) =>
          (b.priority ?? 0) - (a.priority ?? 0)
      );

    if (matching.length === 0) {
      return {
        effect: "deny",
        allowed: false,
        requiresApproval: false,
        matchedRuleIds: [],
        reason: "No matching permission rule"
      };
    }

    const topPriority = matching[0]?.priority ?? 0;

    const topRules = matching.filter(
      (rule) => (rule.priority ?? 0) === topPriority
    );

    const denyRule = topRules.find(
      (rule) => rule.effect === "deny"
    );

    if (denyRule) {
      return {
        effect: "deny",
        allowed: false,
        requiresApproval: false,
        matchedRuleIds: topRules.map((rule) => rule.id),
        reason: denyRule.reason
      };
    }

    const approvalRule = topRules.find(
      (rule) => rule.effect === "approval"
    );

    if (approvalRule) {
      return {
        effect: "approval",
        allowed: false,
        requiresApproval: true,
        matchedRuleIds: topRules.map((rule) => rule.id),
        reason: approvalRule.reason
      };
    }

    return {
      effect: "allow",
      allowed: true,
      requiresApproval: false,
      matchedRuleIds: topRules.map((rule) => rule.id),
      reason: topRules[0]?.reason
    };
  }

  listRules(): PermissionRule[] {
    return [...this.rules.values()];
  }
}

export const permissionEngine =
  new PermissionEngine();

export const StandardActions = {
  DATA_READ: "data.read",
  DATA_WRITE: "data.write",
  DATA_DELETE: "data.delete",

  CRM_READ: "crm.read",
  CRM_WRITE: "crm.write",
  CRM_DELETE: "crm.delete",

  SOCIAL_READ: "social.read",
  SOCIAL_LIKE: "social.like",
  SOCIAL_FOLLOW: "social.follow",
  SOCIAL_DM: "social.dm",
  SOCIAL_POST: "social.post",

  EMAIL_DRAFT: "email.draft",
  EMAIL_SEND: "email.send",

  CODE_READ: "code.read",
  CODE_WRITE: "code.write",
  CODE_DEPLOY: "code.deploy",

  MONEY_READ: "money.read",
  MONEY_TRANSFER: "money.transfer",

  TRADE_SIMULATE: "trade.simulate",
  TRADE_CREATE: "trade.create",
  TRADE_EXECUTE: "trade.execute"
} as const;
