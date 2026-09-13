import {
  readFileSync,
  writeFileSync,
  unlinkSync
} from "node:fs";

patchSystemRoutes();
patchMain();

unlinkSync("scripts/patch-marketplace-phase2.mjs");
unlinkSync(".github/workflows/marketplace-phase2-patch.yml");

function patchSystemRoutes() {
  const path = "apps/api/src/systemRoutes.ts";
  let content = readFileSync(path, "utf8");

  const before = `  registerMarketplaceRoutes({\n    app: input.app,\n    registry: createOfficialMarketplaceRegistry()\n  });`;
  const after = `  registerMarketplaceRoutes({\n    app: input.app,\n    repoRoot: input.repoRoot,\n    registry: createOfficialMarketplaceRegistry()\n  });`;

  if (!content.includes(before)) {
    throw new Error("systemRoutes marketplace registration pattern not found");
  }

  content = content.replace(before, after);
  writeFileSync(path, content);
}

function patchMain() {
  const path = "apps/web/src/main.tsx";
  let content = readFileSync(path, "utf8");

  const importAnchor = `import {\n  PlatformWorkspace,\n  type PlatformView\n} from "./PlatformWorkspace";`;
  const importReplacement = `${importAnchor}\nimport { MarketplaceCenter } from "./MarketplaceCenter";`;

  if (!content.includes(importAnchor)) {
    throw new Error("main.tsx PlatformWorkspace import pattern not found");
  }

  content = content.replace(
    importAnchor,
    importReplacement
  );

  const renderAnchor = `        ) : rootView === "publisher" ? (\n          <PublisherCenter />\n        ) : (\n          <PlatformWorkspace view={rootView} />\n        )}`;
  const renderReplacement = `        ) : rootView === "publisher" ? (\n          <PublisherCenter />\n        ) : rootView === "marketplace" ? (\n          <MarketplaceCenter />\n        ) : (\n          <PlatformWorkspace view={rootView} />\n        )}`;

  if (!content.includes(renderAnchor)) {
    throw new Error("main.tsx root marketplace render pattern not found");
  }

  content = content.replace(
    renderAnchor,
    renderReplacement
  );

  writeFileSync(path, content);
}
