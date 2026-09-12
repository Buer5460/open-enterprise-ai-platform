export type PublisherKind =
  | "github"
  | "local"
  | "custom";

export interface PublishArtifact {
  packageId: string;
  version: string;
  directory: string;
  manifest?: Record<string, unknown>;
}

export interface PublishTarget {
  repository?: string;
  owner?: string;
  branch?: string;
  visibility?: "public" | "private";
  channel?: string;
}

export interface PublishRequest {
  provider: string;
  artifact: PublishArtifact;
  target?: PublishTarget;
  metadata?: Record<string, unknown>;
}

export interface PublishResult {
  ok: boolean;
  provider: string;
  status:
    | "published"
    | "planned"
    | "failed";
  url?: string;
  ref?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export interface PublisherDescriptor {
  id: string;
  kind: PublisherKind;
  displayName: string;
  description?: string;
  capabilities: string[];
  requiresExternalCredential?: boolean;
}

export interface PublisherConnector {
  descriptor: PublisherDescriptor;
  publish(
    request: PublishRequest
  ): Promise<PublishResult>;
}

export class PublisherRegistry {
  private readonly publishers =
    new Map<string, PublisherConnector>();

  register(
    connector: PublisherConnector
  ): void {
    this.publishers.set(
      connector.descriptor.id,
      connector
    );
  }

  unregister(
    publisherId: string
  ): void {
    this.publishers.delete(publisherId);
  }

  get(
    publisherId: string
  ): PublisherConnector | undefined {
    return this.publishers.get(
      publisherId
    );
  }

  list(): PublisherDescriptor[] {
    return [
      ...this.publishers.values()
    ].map(
      (connector) => ({
        ...connector.descriptor
      })
    );
  }

  async publish(
    request: PublishRequest
  ): Promise<PublishResult> {
    const connector =
      this.publishers.get(
        request.provider
      );

    if (!connector) {
      return {
        ok: false,
        provider:
          request.provider,
        status: "failed",
        message:
          `Publisher not registered: ${request.provider}`
      };
    }

    return connector.publish(request);
  }
}

export const publisherRegistry =
  new PublisherRegistry();
