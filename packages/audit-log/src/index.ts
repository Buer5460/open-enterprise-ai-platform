export interface AuditActor {
  type:
    | "user"
    | "agent"
    | "workflow"
    | "package"
    | "system";

  id: string;
}

export interface AuditEvent {
  id: string;

  workspaceId?: string;

  actor: AuditActor;

  action: string;

  resource?: string;

  result:
    | "success"
    | "failed"
    | "denied"
    | "approval_required";

  timestamp: string;

  metadata?: Record<string, unknown>;
}

export class AuditLog {
  private readonly events: AuditEvent[] = [];

  record(
    event: Omit<AuditEvent, "timestamp">
  ): AuditEvent {
    const stored: AuditEvent = {
      ...event,
      timestamp: new Date().toISOString()
    };

    this.events.push(stored);

    return stored;
  }

  list(options?: {
    workspaceId?: string;
    action?: string;
    actorId?: string;
  }): AuditEvent[] {
    return this.events.filter((event) => {
      if (
        options?.workspaceId &&
        event.workspaceId !== options.workspaceId
      ) {
        return false;
      }

      if (
        options?.action &&
        event.action !== options.action
      ) {
        return false;
      }

      if (
        options?.actorId &&
        event.actor.id !== options.actorId
      ) {
        return false;
      }

      return true;
    });
  }

  clear(): void {
    this.events.length = 0;
  }
}

export const auditLog = new AuditLog();
