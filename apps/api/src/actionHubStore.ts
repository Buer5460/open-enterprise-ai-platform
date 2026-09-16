import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";

import type {
  UniversalActionDefinition,
  UniversalActionRisk
} from "@oeap/package-spec";

export type ActionHubApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "cancelled";

export type ActionHubEventStatus =
  | "success"
  | "failed"
  | "approval_required"
  | "approved"
  | "rejected"
  | "cancelled";

export interface ActionHubApproval {
  id: string;
  organizationId: string;
  memberId: string;
  actionId: string;
  actionDisplayName: string;
  risk: UniversalActionRisk;
  input: unknown;
  preferredProvider?: string;
  status: ActionHubApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  executedAt?: string;
  error?: string;
}

export interface ActionHubEvent {
  id: string;
  organizationId: string;
  memberId: string;
  actionId: string;
  status: ActionHubEventStatus;
  createdAt: string;
  durationMs?: number;
  approvalId?: string;
  error?: string;
}

type OrganizationDocument = {
  actions: Record<string, UniversalActionDefinition>;
  approvals: Record<string, ActionHubApproval>;
  events: ActionHubEvent[];
};

type ActionHubDocument = {
  version: 1;
  organizations: Record<string, OrganizationDocument>;
};

type EncryptedDocument = {
  version: 1;
  iv: string;
  tag: string;
  data: string;
};

export class ActionHubStore {
  constructor(
    private readonly dataPath: string,
    private readonly keyPath: string
  ) {
    mkdirSync(dirname(dataPath), { recursive: true });
    mkdirSync(dirname(keyPath), { recursive: true });
    this.ensureKey();
  }

  listActions(
    organizationId: string
  ): UniversalActionDefinition[] {
    const document = this.readDocument();
    const organization = this.organization(
      document,
      organizationId
    );
    const changed = this.seedDefaults(organization);

    if (changed) {
      this.writeDocument(document);
    }

    return Object.values(organization.actions)
      .map((item) => cloneAction(item))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  getAction(
    organizationId: string,
    actionId: string
  ): UniversalActionDefinition | undefined {
    const document = this.readDocument();
    const organization = this.organization(
      document,
      organizationId
    );
    const changed = this.seedDefaults(organization);

    if (changed) {
      this.writeDocument(document);
    }

    const action = organization.actions[actionId];
    return action ? cloneAction(action) : undefined;
  }

  upsertAction(
    organizationId: string,
    action: UniversalActionDefinition
  ): UniversalActionDefinition {
    const document = this.readDocument();
    const organization = this.organization(
      document,
      organizationId
    );

    organization.actions[action.id] = cloneAction(action);
    this.writeDocument(document);
    return cloneAction(action);
  }

  removeAction(
    organizationId: string,
    actionId: string
  ): boolean {
    const document = this.readDocument();
    const organization = this.organization(
      document,
      organizationId
    );

    if (!(actionId in organization.actions)) {
      return false;
    }

    delete organization.actions[actionId];
    this.writeDocument(document);
    return true;
  }

  createApproval(input: {
    organizationId: string;
    memberId: string;
    action: UniversalActionDefinition;
    payload: unknown;
    preferredProvider?: string;
  }): ActionHubApproval {
    const document = this.readDocument();
    const organization = this.organization(
      document,
      input.organizationId
    );

    const approval: ActionHubApproval = {
      id: `ahap_${randomUUID()}`,
      organizationId: input.organizationId,
      memberId: input.memberId,
      actionId: input.action.id,
      actionDisplayName: input.action.displayName,
      risk: input.action.risk,
      input: structuredCloneSafe(input.payload),
      preferredProvider: input.preferredProvider,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    organization.approvals[approval.id] = approval;
    this.writeDocument(document);
    return cloneApproval(approval);
  }

  listApprovals(input: {
    organizationId: string;
    memberId?: string;
    status?: ActionHubApprovalStatus;
    limit?: number;
  }): ActionHubApproval[] {
    const document = this.readDocument();
    const organization = this.organization(
      document,
      input.organizationId
    );

    return Object.values(organization.approvals)
      .filter((item) =>
        (!input.memberId || item.memberId === input.memberId) &&
        (!input.status || item.status === input.status)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, safeLimit(input.limit))
      .map(cloneApproval);
  }

  getApproval(
    organizationId: string,
    approvalId: string
  ): ActionHubApproval | undefined {
    const document = this.readDocument();
    const organization = this.organization(
      document,
      organizationId
    );
    const approval = organization.approvals[approvalId];
    return approval ? cloneApproval(approval) : undefined;
  }

  decideApproval(input: {
    organizationId: string;
    approvalId: string;
    decidedBy: string;
    decision: "approved" | "rejected";
  }): ActionHubApproval {
    const document = this.readDocument();
    const organization = this.organization(
      document,
      input.organizationId
    );
    const approval = organization.approvals[input.approvalId];

    if (!approval) {
      throw new Error("Action Hub approval not found");
    }

    if (approval.status !== "pending") {
      throw new Error(`Action Hub approval is ${approval.status}`);
    }

    approval.status = input.decision;
    approval.decidedBy = input.decidedBy;
    approval.decidedAt = new Date().toISOString();
    this.writeDocument(document);
    return cloneApproval(approval);
  }

  markApprovalExecution(input: {
    organizationId: string;
    approvalId: string;
    status: "executed" | "failed";
    error?: string;
  }): ActionHubApproval {
    const document = this.readDocument();
    const organization = this.organization(
      document,
      input.organizationId
    );
    const approval = organization.approvals[input.approvalId];

    if (!approval) {
      throw new Error("Action Hub approval not found");
    }

    if (approval.status !== "approved") {
      throw new Error("Action Hub approval must be approved before execution");
    }

    approval.status = input.status;
    approval.executedAt = new Date().toISOString();
    approval.error = input.error;
    this.writeDocument(document);
    return cloneApproval(approval);
  }

  cancelApproval(input: {
    organizationId: string;
    approvalId: string;
    memberId: string;
    manager: boolean;
  }): ActionHubApproval {
    const document = this.readDocument();
    const organization = this.organization(
      document,
      input.organizationId
    );
    const approval = organization.approvals[input.approvalId];

    if (!approval) {
      throw new Error("Action Hub approval not found");
    }

    if (
      !input.manager &&
      approval.memberId !== input.memberId
    ) {
      throw new Error("Action Hub approval belongs to another member");
    }

    if (approval.status !== "pending") {
      throw new Error(`Action Hub approval is ${approval.status}`);
    }

    approval.status = "cancelled";
    approval.decidedAt = new Date().toISOString();
    approval.decidedBy = input.memberId;
    this.writeDocument(document);
    return cloneApproval(approval);
  }

  recordEvent(
    input: Omit<ActionHubEvent, "id" | "createdAt">
  ): ActionHubEvent {
    const document = this.readDocument();
    const organization = this.organization(
      document,
      input.organizationId
    );
    const event: ActionHubEvent = {
      ...input,
      id: `ahev_${randomUUID()}`,
      createdAt: new Date().toISOString()
    };

    organization.events.unshift(event);
    if (organization.events.length > 1000) {
      organization.events.length = 1000;
    }

    this.writeDocument(document);
    return { ...event };
  }

  listEvents(input: {
    organizationId: string;
    memberId?: string;
    limit?: number;
  }): ActionHubEvent[] {
    const document = this.readDocument();
    const organization = this.organization(
      document,
      input.organizationId
    );

    return organization.events
      .filter((item) =>
        !input.memberId || item.memberId === input.memberId
      )
      .slice(0, safeLimit(input.limit))
      .map((item) => ({ ...item }));
  }

  private seedDefaults(
    organization: OrganizationDocument
  ): boolean {
    let changed = false;

    for (const action of defaultActions()) {
      if (!organization.actions[action.id]) {
        organization.actions[action.id] = action;
        changed = true;
      }
    }

    return changed;
  }

  private organization(
    document: ActionHubDocument,
    organizationId: string
  ): OrganizationDocument {
    const existing = document.organizations[organizationId];
    if (existing) return existing;

    const created: OrganizationDocument = {
      actions: {},
      approvals: {},
      events: []
    };
    document.organizations[organizationId] = created;
    return created;
  }

  private ensureKey(): void {
    if (existsSync(this.keyPath)) return;
    writeFileSync(this.keyPath, randomBytes(32), { mode: 0o600 });
  }

  private readKey(): Buffer {
    const key = readFileSync(this.keyPath);
    if (key.length !== 32) {
      throw new Error("OEAP Action Hub encryption key is invalid");
    }
    return key;
  }

  private readDocument(): ActionHubDocument {
    if (!existsSync(this.dataPath)) {
      return {
        version: 1,
        organizations: {}
      };
    }

    const encrypted = JSON.parse(
      readFileSync(this.dataPath, "utf8")
    ) as EncryptedDocument;

    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.readKey(),
      Buffer.from(encrypted.iv, "base64")
    );
    decipher.setAuthTag(
      Buffer.from(encrypted.tag, "base64")
    );

    const plaintext = Buffer.concat([
      decipher.update(
        Buffer.from(encrypted.data, "base64")
      ),
      decipher.final()
    ]).toString("utf8");

    return JSON.parse(plaintext) as ActionHubDocument;
  }

  private writeDocument(
    document: ActionHubDocument
  ): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.readKey(),
      iv
    );
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(document), "utf8"),
      cipher.final()
    ]);

    const encrypted: EncryptedDocument = {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: ciphertext.toString("base64")
    };

    writeFileSync(
      this.dataPath,
      JSON.stringify(encrypted, null, 2),
      { mode: 0o600 }
    );
  }
}

function defaultActions(): UniversalActionDefinition[] {
  return [
    {
      id: "ai.generate",
      version: "1.0.0",
      displayName: "AI 内容生成",
      description: "通过当前组织配置的 AI Runtime 生成文本内容。",
      capability: "ai.generate",
      permissionAction: "ai.generate",
      risk: "R0",
      enabled: true,
      inputSchema: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: {
            type: "string",
            description: "发送给模型的提示词"
          }
        }
      },
      outputSchema: {
        type: "object",
        properties: {
          text: { type: "string" }
        }
      },
      tags: ["ai", "builtin"],
      metadata: {
        builtin: true
      }
    },
    {
      id: "email.send",
      version: "1.0.0",
      displayName: "发送邮件",
      description: "通过已安装的邮件 Connector 发送邮件；属于外部写操作，需要审批。",
      capability: "email.send",
      permissionAction: "email.send",
      risk: "R2",
      enabled: false,
      inputSchema: {
        type: "object",
        required: ["to", "subject", "body"],
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" }
        }
      },
      tags: ["email", "template"],
      metadata: {
        builtin: true,
        template: true
      }
    },
    {
      id: "money.transfer",
      version: "1.0.0",
      displayName: "资金转账",
      description: "通过受控资金 Connector 发起转账；高风险操作需要审批和显式确认。",
      capability: "money.transfer",
      permissionAction: "money.transfer",
      risk: "R3",
      enabled: false,
      inputSchema: {
        type: "object",
        required: ["amount", "currency", "destination"],
        properties: {
          amount: { type: "number" },
          currency: { type: "string" },
          destination: { type: "string" }
        }
      },
      tags: ["payment", "template"],
      metadata: {
        builtin: true,
        template: true
      }
    }
  ];
}

function cloneAction(
  action: UniversalActionDefinition
): UniversalActionDefinition {
  return structuredCloneSafe(action) as UniversalActionDefinition;
}

function cloneApproval(
  approval: ActionHubApproval
): ActionHubApproval {
  return structuredCloneSafe(approval) as ActionHubApproval;
}

function structuredCloneSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function safeLimit(value?: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(500, Math.floor(value ?? 100)));
}
