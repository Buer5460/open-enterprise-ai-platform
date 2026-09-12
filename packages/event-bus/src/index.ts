export interface OEAPEvent<TPayload = unknown> {
  id: string;
  type: string;
  timestamp: string;

  workspaceId?: string;

  source?: {
    type:
      | "user"
      | "agent"
      | "workflow"
      | "package"
      | "system";

    id: string;
  };

  payload: TPayload;

  metadata?: Record<string, unknown>;
}

export type EventHandler<TPayload = unknown> = (
  event: OEAPEvent<TPayload>
) => void | Promise<void>;

export interface EventSubscription {
  id: string;
  pattern: string;
  handler: EventHandler;
}

function matchesEvent(
  eventType: string,
  pattern: string
): boolean {
  if (pattern === "*") {
    return true;
  }

  if (pattern.endsWith(".*")) {
    return eventType.startsWith(
      pattern.slice(0, -1)
    );
  }

  return eventType === pattern;
}

export class EventBus {
  private readonly subscriptions =
    new Map<string, EventSubscription>();

  subscribe(
    subscription: EventSubscription
  ): () => void {
    if (
      this.subscriptions.has(subscription.id)
    ) {
      throw new Error(
        `Subscription already exists: ${subscription.id}`
      );
    }

    this.subscriptions.set(
      subscription.id,
      subscription
    );

    return () => {
      this.unsubscribe(subscription.id);
    };
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  async publish<TPayload>(
    input: Omit<
      OEAPEvent<TPayload>,
      "timestamp"
    >
  ): Promise<OEAPEvent<TPayload>> {
    const event: OEAPEvent<TPayload> = {
      ...input,
      timestamp: new Date().toISOString()
    };

    const handlers = [
      ...this.subscriptions.values()
    ].filter((subscription) =>
      matchesEvent(
        event.type,
        subscription.pattern
      )
    );

    await Promise.all(
      handlers.map((subscription) =>
        subscription.handler(event)
      )
    );

    return event;
  }

  listSubscriptions(): EventSubscription[] {
    return [
      ...this.subscriptions.values()
    ];
  }
}

export const eventBus = new EventBus();

export const StandardEvents = {
  APP_INSTALLED: "app.installed",
  PACKAGE_INSTALLED: "package.installed",

  TASK_CREATED: "task.created",
  TASK_COMPLETED: "task.completed",
  TASK_FAILED: "task.failed",

  LEAD_CREATED: "lead.created",
  LEAD_SCORED: "lead.scored",

  ACTION_EXECUTED: "action.executed",
  ACTION_DENIED: "action.denied",

  APPROVAL_CREATED: "approval.created",
  APPROVAL_APPROVED: "approval.approved",
  APPROVAL_REJECTED: "approval.rejected",

  MESSAGE_SENT: "message.sent",
  MESSAGE_REPLIED: "message.replied",

  WORKFLOW_STARTED: "workflow.started",
  WORKFLOW_COMPLETED: "workflow.completed",
  WORKFLOW_FAILED: "workflow.failed"
} as const;
