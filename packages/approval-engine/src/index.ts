export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

export interface ApprovalRequest {
  id: string;

  workspaceId?: string;

  requestedBy: {
    type: "user" | "agent" | "workflow" | "package" | "system";
    id: string;
  };

  action: string;

  resource?: string;

  payload?: unknown;

  reason?: string;

  status: ApprovalStatus;

  createdAt: string;

  resolvedAt?: string;

  resolvedBy?: string;

  metadata?: Record<string, unknown>;
}

export class ApprovalEngine {
  private readonly requests =
    new Map<string, ApprovalRequest>();

  create(
    input: Omit<
      ApprovalRequest,
      "status" | "createdAt"
    >
  ): ApprovalRequest {
    if (this.requests.has(input.id)) {
      throw new Error(
        `Approval request already exists: ${input.id}`
      );
    }

    const request: ApprovalRequest = {
      ...input,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    this.requests.set(request.id, request);

    return request;
  }

  approve(
    id: string,
    resolvedBy: string
  ): ApprovalRequest {
    return this.resolve(id, "approved", resolvedBy);
  }

  reject(
    id: string,
    resolvedBy: string
  ): ApprovalRequest {
    return this.resolve(id, "rejected", resolvedBy);
  }

  cancel(id: string): ApprovalRequest {
    return this.resolve(id, "cancelled", "system");
  }

  get(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  list(status?: ApprovalStatus): ApprovalRequest[] {
    const items = [...this.requests.values()];

    if (!status) {
      return items;
    }

    return items.filter(
      (item) => item.status === status
    );
  }

  private resolve(
    id: string,
    status: ApprovalStatus,
    resolvedBy: string
  ): ApprovalRequest {
    const request = this.requests.get(id);

    if (!request) {
      throw new Error(
        `Approval request not found: ${id}`
      );
    }

    if (request.status !== "pending") {
      throw new Error(
        `Approval request is not pending: ${id}`
      );
    }

    const updated: ApprovalRequest = {
      ...request,
      status,
      resolvedBy,
      resolvedAt: new Date().toISOString()
    };

    this.requests.set(id, updated);

    return updated;
  }
}

export const approvalEngine =
  new ApprovalEngine();
