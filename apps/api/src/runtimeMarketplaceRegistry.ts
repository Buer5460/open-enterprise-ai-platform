import {
  InMemoryMarketplaceRegistry,
  officialMarketplaceListings,
  officialMarketplacePublisher,
  type MarketplaceRegistry
} from "@oeap/marketplace-registry";

import {
  MarketplacePublishingStore
} from "./marketplacePublishingStore.js";
import { runtimePath } from "./runtimePaths.js";

export interface RuntimeMarketplace {
  registry: MarketplaceRegistry;
  publishing: MarketplacePublishingStore;
}

export function createRuntimeMarketplace(
  repoRoot: string
): RuntimeMarketplace {
  const publishing = new MarketplacePublishingStore(
    runtimePath(
      repoRoot,
      "marketplace",
      "publishing.sqlite"
    )
  );
  const approved = publishing.listApprovedEntries();

  const publishers = new Map(
    approved.map((entry) => [
      entry.publisher.id,
      entry.publisher
    ])
  );

  const registry = new InMemoryMarketplaceRegistry({
    publishers: [
      officialMarketplacePublisher,
      ...publishers.values()
    ],
    listings: [
      ...officialMarketplaceListings,
      ...approved.map((entry) => entry.listing)
    ],
    artifacts: approved
      .map((entry) => entry.artifact)
      .filter((artifact) => artifact !== undefined)
  });

  return {
    registry,
    publishing
  };
}
