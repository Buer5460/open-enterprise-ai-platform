import {
  capabilityRegistry,
  type CapabilityProvider
} from "@oeap/capability-registry";

export type ConnectorTransport =
  | "mcp"
  | "rest"
  | "graphql"
  | "sdk"
  | "local";

export interface ConnectorContext {
  workspaceId?: string;
  userId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

export interface ConnectorInvocation<TInput = unknown> {
  capability: string;
  input: TInput;
  preferredProvider?: string;
  context?: ConnectorContext;
}

export interface ConnectorResult<TOutput = unknown> {
  ok: boolean;
  output?: TOutput;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  metadata?: Record<string, unknown>;
}

export interface ConnectorExecutor {
  id: string;
  packageId: string;
  version: string;
  transport: ConnectorTransport;

  execute(
    capability: string,
    input: unknown,
    context?: ConnectorContext
  ): Promise<ConnectorResult>;
}

export interface RegisterConnectorOptions {
  executor: ConnectorExecutor;

  capabilities: Array<{
    id: string;
    priority?: number;
    metadata?: Record<string, unknown>;
  }>;
}

export interface MCPServerConfig {
  id: string;

  transport:
    | {
        type: "stdio";
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }
    | {
        type: "http";
        url: string;
        headers?: Record<string, string>;
      };

  metadata?: Record<string, unknown>;
}

export interface MCPToolDescriptor {
  serverId: string;
  toolName: string;
  capability: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export class ConnectorRuntime {
  private readonly executors = new Map<string, ConnectorExecutor>();

  register(options: RegisterConnectorOptions): void {
    const { executor, capabilities } = options;

    if (this.executors.has(executor.id)) {
      throw new Error(
        `Connector already registered: ${executor.id}`
      );
    }

    this.executors.set(executor.id, executor);

    for (const capability of capabilities) {
      const provider: CapabilityProvider = {
        id: executor.id,
        capability: capability.id,
        packageId: executor.packageId,
        version: executor.version,
        priority: capability.priority,
        metadata: {
          transport: executor.transport,
          ...capability.metadata
        }
      };

      capabilityRegistry.register(provider);
    }
  }

  unregister(connectorId: string): void {
    this.executors.delete(connectorId);
    capabilityRegistry.unregister(connectorId);
  }

  async invoke<TInput = unknown, TOutput = unknown>(
    invocation: ConnectorInvocation<TInput>
  ): Promise<ConnectorResult<TOutput>> {
    const provider = capabilityRegistry.resolve({
      capability: invocation.capability,
      preferredProvider: invocation.preferredProvider
    });

    if (!provider) {
      return {
        ok: false,
        error: {
          code: "CAPABILITY_NOT_FOUND",
          message: `No provider found for capability: ${invocation.capability}`
        }
      };
    }

    const executor = this.executors.get(provider.id);

    if (!executor) {
      return {
        ok: false,
        error: {
          code: "CONNECTOR_NOT_AVAILABLE",
          message: `Connector executor not available: ${provider.id}`
        }
      };
    }

    return executor.execute(
      invocation.capability,
      invocation.input,
      invocation.context
    ) as Promise<ConnectorResult<TOutput>>;
  }

  listConnectors(): ConnectorExecutor[] {
    return [...this.executors.values()];
  }
}

export const connectorRuntime = new ConnectorRuntime();
