import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { runtimeStoragePath } from "./storagePath.js";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export interface OperationEvent {
  id: number;
  organizationId: string;
  memberId?: string;
  category: string;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  organizationId: string;
  createdBy: string;
  title: string;
  description?: string;
  actionType: string;
  payload?: unknown;
  status: ApprovalStatus;
  decidedBy?: string;
  decisionNote?: string;
  createdAt: string;
  decidedAt?: string;
}

export class OperationsStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    const resolvedPath = runtimeStoragePath(path);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.db = new DatabaseSync(resolvedPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL,
        member_id TEXT,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        duration_ms REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_operation_events_org_created
        ON operation_events (organization_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_operation_events_member_created
        ON operation_events (organization_id, member_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        action_type TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL,
        decided_by TEXT,
        decision_note TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approval_org_status_created
        ON approval_requests (organization_id, status, created_at DESC);
    `);
  }

  recordEvent(input: {
    organizationId: string;
    memberId?: string;
    category: string;
    action: string;
    method: string;
    path: string;
    statusCode: number;
    durationMs?: number;
  }): void {
    if (
      !input.organizationId ||
      input.organizationId.startsWith("__unauthenticated")
    ) {
      return;
    }

    this.db.prepare(`
      INSERT INTO operation_events
        (organization_id, member_id, category, action, method, path,
         status_code, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.organizationId,
      input.memberId || null,
      input.category,
      input.action,
      input.method,
      input.path,
      input.statusCode,
      input.durationMs ?? 0,
      new Date().toISOString()
    );
  }

  listEvents(input: {
    organizationId: string;
    memberId?: string;
    limit?: number;
  }): OperationEvent[] {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const rows = input.memberId
      ? this.db.prepare(`
          SELECT * FROM operation_events
          WHERE organization_id = ? AND member_id = ?
          ORDER BY id DESC
          LIMIT ?
        `).all(input.organizationId, input.memberId, limit)
      : this.db.prepare(`
          SELECT * FROM operation_events
          WHERE organization_id = ?
          ORDER BY id DESC
          LIMIT ?
        `).all(input.organizationId, limit);

    return (rows as any[]).map(mapEvent);
  }

  summary(input: {
    organizationId: string;
    memberId?: string;
    days?: number;
  }) {
    const days = Math.max(1, Math.min(input.days ?? 30, 365));
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    ).toISOString();
    const where = input.memberId
      ? "organization_id = ? AND member_id = ? AND created_at >= ?"
      : "organization_id = ? AND created_at >= ?";
    const params = input.memberId
      ? [input.organizationId, input.memberId, since]
      : [input.organizationId, since];

    const total = this.db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failures,
             SUM(CASE WHEN category = 'ai' THEN 1 ELSE 0 END) AS ai_calls,
             SUM(CASE WHEN category = 'file' THEN 1 ELSE 0 END) AS file_actions,
             AVG(duration_ms) AS avg_duration
      FROM operation_events
      WHERE ${where}
    `).get(...params) as any;

    const categories = this.db.prepare(`
      SELECT category, COUNT(*) AS total
      FROM operation_events
      WHERE ${where}
      GROUP BY category
      ORDER BY total DESC
    `).all(...params) as any[];

    const daily = this.db.prepare(`
      SELECT substr(created_at, 1, 10) AS day,
             COUNT(*) AS total,
             SUM(CASE WHEN category = 'ai' THEN 1 ELSE 0 END) AS ai_calls,
             SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failures
      FROM operation_events
      WHERE ${where}
      GROUP BY substr(created_at, 1, 10)
      ORDER BY day ASC
    `).all(...params) as any[];

    const pending = input.memberId
      ? this.db.prepare(`
          SELECT COUNT(*) AS total
          FROM approval_requests
          WHERE organization_id = ? AND created_by = ? AND status = 'pending'
        `).get(input.organizationId, input.memberId) as any
      : this.db.prepare(`
          SELECT COUNT(*) AS total
          FROM approval_requests
          WHERE organization_id = ? AND status = 'pending'
        `).get(input.organizationId) as any;

    return {
      days,
      total: Number(total?.total ?? 0),
      failures: Number(total?.failures ?? 0),
      aiCalls: Number(total?.ai_calls ?? 0),
      fileActions: Number(total?.file_actions ?? 0),
      averageDurationMs: Math.round(Number(total?.avg_duration ?? 0)),
      pendingApprovals: Number(pending?.total ?? 0),
      categories: categories.map((row) => ({
        category: String(row.category),
        total: Number(row.total)
      })),
      daily: daily.map((row) => ({
        day: String(row.day),
        total: Number(row.total),
        aiCalls: Number(row.ai_calls ?? 0),
        failures: Number(row.failures ?? 0)
      }))
    };
  }

  createApproval(input: {
    organizationId: string;
    createdBy: string;
    title: string;
    description?: string;
    actionType: string;
    payload?: unknown;
  }): ApprovalRequest {
    const id = `approval_${randomUUID()}`;
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO approval_requests
        (id, organization_id, created_by, title, description,
         action_type, payload, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      id,
      input.organizationId,
      input.createdBy,
      input.title.trim(),
      input.description?.trim() || null,
      input.actionType.trim(),
      input.payload === undefined
        ? null
        : JSON.stringify(input.payload),
      createdAt
    );

    return this.requireApproval(id);
  }

  listApprovals(input: {
    organizationId: string;
    createdBy?: string;
    status?: ApprovalStatus;
    limit?: number;
  }): ApprovalRequest[] {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const clauses = ["organization_id = ?"];
    const params: Array<string | number> = [input.organizationId];

    if (input.createdBy) {
      clauses.push("created_by = ?");
      params.push(input.createdBy);
    }

    if (input.status) {
      clauses.push("status = ?");
      params.push(input.status);
    }

    params.push(limit);

    return (this.db.prepare(`
      SELECT * FROM approval_requests
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params) as any[]).map(mapApproval);
  }

  decide(input: {
    id: string;
    organizationId: string;
    decidedBy: string;
    decision: "approved" | "rejected";
    note?: string;
  }): ApprovalRequest {
    const current = this.requireApproval(input.id);

    if (current.organizationId !== input.organizationId) {
      throw new Error("Approval does not belong to organization");
    }
    if (current.status !== "pending") {
      throw new Error(`Approval is already ${current.status}`);
    }

    this.db.prepare(`
      UPDATE approval_requests
      SET status = ?, decided_by = ?, decision_note = ?, decided_at = ?
      WHERE id = ?
    `).run(
      input.decision,
      input.decidedBy,
      input.note?.trim() || null,
      new Date().toISOString(),
      input.id
    );

    return this.requireApproval(input.id);
  }

  cancel(input: {
    id: string;
    organizationId: string;
    memberId: string;
  }): ApprovalRequest {
    const current = this.requireApproval(input.id);
    if (
      current.organizationId !== input.organizationId ||
      current.createdBy !== input.memberId
    ) {
      throw new Error("Approval cannot be cancelled by current member");
    }
    if (current.status !== "pending") {
      throw new Error("Only pending approval can be cancelled");
    }

    this.db.prepare(`
      UPDATE approval_requests
      SET status = 'cancelled', decided_by = ?, decided_at = ?
      WHERE id = ?
    `).run(
      input.memberId,
      new Date().toISOString(),
      input.id
    );

    return this.requireApproval(input.id);
  }

  private requireApproval(id: string): ApprovalRequest {
    const row = this.db.prepare(`
      SELECT * FROM approval_requests WHERE id = ?
    `).get(id) as any;

    if (!row) throw new Error("Approval not found");
    return mapApproval(row);
  }
}

function mapEvent(row: any): OperationEvent {
  return {
    id: Number(row.id),
    organizationId: String(row.organization_id),
    memberId: row.member_id ? String(row.member_id) : undefined,
    category: String(row.category),
    action: String(row.action),
    method: String(row.method),
    path: String(row.path),
    statusCode: Number(row.status_code),
    durationMs: Number(row.duration_ms),
    createdAt: String(row.created_at)
  };
}

function mapApproval(row: any): ApprovalRequest {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    createdBy: String(row.created_by),
    title: String(row.title),
    description: row.description ? String(row.description) : undefined,
    actionType: String(row.action_type),
    payload: row.payload ? safeJson(row.payload) : undefined,
    status: String(row.status) as ApprovalStatus,
    decidedBy: row.decided_by ? String(row.decided_by) : undefined,
    decisionNote: row.decision_note ? String(row.decision_note) : undefined,
    createdAt: String(row.created_at),
    decidedAt: row.decided_at ? String(row.decided_at) : undefined
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
