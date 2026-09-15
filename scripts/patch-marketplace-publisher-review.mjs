import {
  readFileSync,
  writeFileSync,
  unlinkSync
} from "node:fs";

patchSystemRoutes();
patchMain();
patchTestCi();

unlinkSync("scripts/patch-marketplace-publisher-review.mjs");
unlinkSync(".github/workflows/marketplace-publisher-review-patch.yml");

function replaceOrThrow(path, before, after, label) {
  let content = readFileSync(path, "utf8");
  if (!content.includes(before)) {
    throw new Error(`${label} pattern not found in ${path}`);
  }
  content = content.replace(before, after);
  writeFileSync(path, content);
}

function patchSystemRoutes() {
  const path = "apps/api/src/systemRoutes.ts";
  replaceOrThrow(
    path,
    `import {\n  createOfficialMarketplaceRegistry\n} from "@oeap/marketplace-registry";\n\nimport {\n  registerMarketplaceRoutes\n} from "./marketplaceRoutes.js";`,
    `import {\n  registerMarketplaceRoutes\n} from "./marketplaceRoutes.js";\nimport {\n  registerMarketplacePublishingRoutes\n} from "./marketplacePublishingRoutes.js";\nimport {\n  createRuntimeMarketplace\n} from "./runtimeMarketplaceRegistry.js";`,
    "system marketplace imports"
  );

  replaceOrThrow(
    path,
    `  registerMarketplaceRoutes({\n    app: input.app,\n    repoRoot: input.repoRoot,\n    registry: createOfficialMarketplaceRegistry()\n  });`,
    `  const marketplace =\n    createRuntimeMarketplace(input.repoRoot);\n\n  registerMarketplaceRoutes({\n    app: input.app,\n    repoRoot: input.repoRoot,\n    registry: marketplace.registry\n  });\n\n  registerMarketplacePublishingRoutes({\n    app: input.app,\n    repoRoot: input.repoRoot,\n    registry: marketplace.registry,\n    store: marketplace.publishing\n  });`,
    "runtime marketplace registration"
  );
}

function patchMain() {
  const path = "apps/web/src/main.tsx";
  replaceOrThrow(
    path,
    `import { MarketplaceCenter } from "./MarketplaceCenter";`,
    `import { MarketplaceCenter } from "./MarketplaceCenter";\nimport { MarketplacePublisherStudio } from "./MarketplacePublisherStudio";`,
    "publisher studio import"
  );

  replaceOrThrow(
    path,
    `  | "publisher"\n  | PlatformView;`,
    `  | "publisher"\n  | "marketplacePublisher"\n  | PlatformView;`,
    "root view type"
  );

  replaceOrThrow(
    path,
    `          <button className={rootView === "marketplace" ? "active" : ""} onClick={() => setRootView("marketplace")}>◇ Marketplace</button>\n          <button className={rootView === "developer" ? "active" : ""} onClick={() => setRootView("developer")}>&lt;/&gt; Developer</button>`,
    `          <button className={rootView === "marketplace" ? "active" : ""} onClick={() => setRootView("marketplace")}>◇ Marketplace</button>\n          <button className={rootView === "marketplacePublisher" ? "active" : ""} onClick={() => setRootView("marketplacePublisher")}>🧩 商店发布</button>\n          <button className={rootView === "developer" ? "active" : ""} onClick={() => setRootView("developer")}>&lt;/&gt; Developer</button>`,
    "publisher nav"
  );

  replaceOrThrow(
    path,
    `        ) : rootView === "marketplace" ? (\n          <MarketplaceCenter />\n        ) : (`,
    `        ) : rootView === "marketplace" ? (\n          <MarketplaceCenter />\n        ) : rootView === "marketplacePublisher" ? (\n          <MarketplacePublisherStudio />\n        ) : (`,
    "publisher studio render"
  );
}

function patchTestCi() {
  const path = "scripts/test-ci.sh";
  replaceOrThrow(
    path,
    `run_if_present scripts/test-marketplace-commerce.mjs\n`,
    `run_if_present scripts/test-marketplace-commerce.mjs\nrun_if_present scripts/test-marketplace-publishing-store.mjs\n`,
    "publishing store test"
  );
  replaceOrThrow(
    path,
    `run_if_present scripts/test-marketplace-api.mjs\n`,
    `run_if_present scripts/test-marketplace-api.mjs\nrun_if_present scripts/test-marketplace-publishing-api.mjs\n`,
    "publishing api test"
  );
}
