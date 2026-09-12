export interface CapabilityProvider {
  id: string;

  capability: string;

  packageId: string;

  version: string;

  priority?: number;

  metadata?: Record<string, unknown>;
}

export interface CapabilityQuery {
  capability: string;
  preferredProvider?: string;
}

export class CapabilityRegistry {
  private readonly providers = new Map<string, CapabilityProvider[]>();

  register(provider: CapabilityProvider): void {
    const current = this.providers.get(provider.capability) ?? [];

    const exists = current.some(
      (item) =>
        item.id === provider.id &&
        item.packageId === provider.packageId
    );

    if (exists) {
      throw new Error(
        `Capability provider already registered: ${provider.id}`
      );
    }

    current.push(provider);

    current.sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );

    this.providers.set(provider.capability, current);
  }

  unregister(providerId: string): void {
    for (const [capability, providers] of this.providers.entries()) {
      const filtered = providers.filter(
        (provider) => provider.id !== providerId
      );

      if (filtered.length === 0) {
        this.providers.delete(capability);
      } else {
        this.providers.set(capability, filtered);
      }
    }
  }

  resolve(query: CapabilityQuery): CapabilityProvider | undefined {
    const providers = this.providers.get(query.capability) ?? [];

    if (query.preferredProvider) {
      const preferred = providers.find(
        (provider) =>
          provider.id === query.preferredProvider ||
          provider.packageId === query.preferredProvider
      );

      if (preferred) {
        return preferred;
      }
    }

    return providers[0];
  }

  list(capability?: string): CapabilityProvider[] {
    if (capability) {
      return [...(this.providers.get(capability) ?? [])];
    }

    return [...this.providers.values()].flat();
  }

  has(capability: string): boolean {
    return (this.providers.get(capability)?.length ?? 0) > 0;
  }
}

export const capabilityRegistry = new CapabilityRegistry();
