import {
  readFileSync,
  writeFileSync,
  unlinkSync
} from "node:fs";

patchMarketplaceRoutes();
patchPlatformRoutes();
patchRegistry();
patchMarketplaceTests();
patchTestCi();

unlinkSync("scripts/patch-marketplace-runtime.mjs");
unlinkSync(".github/workflows/marketplace-runtime-patch.yml");

function replaceOrThrow(path, before, after, label) {
  let content = readFileSync(path, "utf8");
  if (!content.includes(before)) {
    throw new Error(`${label} pattern not found in ${path}`);
  }
  content = content.replace(before, after);
  writeFileSync(path, content);
}

function patchMarketplaceRoutes() {
  const path = "apps/api/src/marketplaceRoutes.ts";
  replaceOrThrow(
    path,
    `import {\n  MarketplaceCommerceStore\n} from "./marketplaceCommerceStore.js";`,
    `import {\n  MarketplaceCommerceStore\n} from "./marketplaceCommerceStore.js";\nimport {\n  OfficialPackageActivator\n} from "./officialPackageActivator.js";`,
    "marketplace activator import"
  );

  replaceOrThrow(
    path,
    `  const tenancy = new TenancyStore(\n    runtimePath(\n      input.repoRoot,\n      "tenancy",\n      "tenancy.sqlite"\n    )\n  );`,
    `  const tenancy = new TenancyStore(\n    runtimePath(\n      input.repoRoot,\n      "tenancy",\n      "tenancy.sqlite"\n    )\n  );\n  const activator =\n    new OfficialPackageActivator(input.repoRoot);`,
    "marketplace activator creation"
  );

  replaceOrThrow(
    path,
    `      if (existing?.status === "active") {\n        return {\n          ok: true,\n          alreadyOwned: true,\n          entitlement: existing\n        };\n      }`,
    `      if (existing?.status === "active") {\n        const activation = await activateIfOfficial(\n          activator,\n          identity.organizationId,\n          listing.packageId\n        );\n        return {\n          ok: true,\n          alreadyOwned: true,\n          entitlement: existing,\n          activation\n        };\n      }`,
    "already-owned activation"
  );

  replaceOrThrow(
    path,
    `        return reply.code(201).send({\n          ok: true,\n          paymentRequired: false,\n          entitlement\n        });`,
    `        const activation = await activateIfOfficial(\n          activator,\n          identity.organizationId,\n          listing.packageId\n        );\n\n        return reply.code(201).send({\n          ok: true,\n          paymentRequired: false,\n          entitlement,\n          activation\n        });`,
    "free acquisition activation"
  );

  replaceOrThrow(
    path,
    `      return {\n        ok: true,\n        entitlement\n      };\n    }\n  );\n\n  return { registry, commerce };`,
    `      const activation =\n        await disableIfOfficial(\n          activator,\n          identity.organizationId,\n          request.params.packageId\n        );\n\n      return {\n        ok: true,\n        entitlement,\n        activation\n      };\n    }\n  );\n\n  return { registry, commerce };`,
    "entitlement cancellation activation"
  );

  replaceOrThrow(
    path,
    `async function publicListing(\n  registry: MarketplaceRegistry,`,
    `async function activateIfOfficial(\n  activator: OfficialPackageActivator,\n  organizationId: string,\n  packageId: string\n) {\n  if (!(await activator.hasOfficialPackage(packageId))) {\n    return {\n      status: "metadata-only" as const,\n      packageId\n    };\n  }\n\n  try {\n    const result = await activator.enableForOrganization(\n      organizationId,\n      packageId\n    );\n    return {\n      status: "enabled" as const,\n      ...result\n    };\n  } catch (error) {\n    return {\n      status: "activation-failed" as const,\n      packageId,\n      error:\n        error instanceof Error\n          ? error.message\n          : "Package activation failed"\n    };\n  }\n}\n\nasync function disableIfOfficial(\n  activator: OfficialPackageActivator,\n  organizationId: string,\n  packageId: string\n) {\n  if (!(await activator.hasOfficialPackage(packageId))) {\n    return {\n      status: "metadata-only" as const,\n      packageId\n    };\n  }\n\n  try {\n    const result = await activator.disableForOrganization(\n      organizationId,\n      packageId\n    );\n    return {\n      status: "disabled" as const,\n      ...result\n    };\n  } catch (error) {\n    return {\n      status: "disable-failed" as const,\n      packageId,\n      error:\n        error instanceof Error\n          ? error.message\n          : "Package disable failed"\n    };\n  }\n}\n\nasync function publicListing(\n  registry: MarketplaceRegistry,`,
    "marketplace activation helpers"
  );
}

function patchPlatformRoutes() {
  const path = "apps/api/src/platformRoutes.ts";
  replaceOrThrow(
    path,
    `import { join } from "node:path";\nimport { pathToFileURL } from "node:url";\n\nimport {\n  packageManager,\n  type PackageRuntimeModule\n} from "@oeap/package-manager";`,
    `import {\n  OfficialPackageActivator\n} from "./officialPackageActivator.js";`,
    "platform activator imports"
  );

  const helperStart = `  async function loadOfficialRuntimeModule(\n    packageId: string\n  ): Promise<PackageRuntimeModule> {`;
  const helperEnd = `\n  app.get(\n    "/api/platform/packages",`;
  let content = readFileSync(path, "utf8");
  const start = content.indexOf(helperStart);
  const end = content.indexOf(helperEnd);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("platform runtime helper block not found");
  }
  content =
    content.slice(0, start) +
    `  const officialActivator =\n    new OfficialPackageActivator(repoRoot);\n` +
    content.slice(end);
  writeFileSync(path, content);

  replaceOrThrow(
    path,
    `      try {\n        if (!packageManager.get(packageId)) {\n          const runtimeModule = await loadOfficialRuntimeModule(packageId);\n          await packageManager.install(runtimeModule);\n        }\n\n        if (!packageManager.isEnabled(packageId)) {\n          await packageManager.enable(packageId);\n        }\n\n        organizationPackages.set(\n          identity.organizationId,\n          packageId,\n          "enabled"\n        );\n\n        return {\n          ok: true,\n          package: {\n            id: packageId,\n            status: "enabled",\n            organizationId: identity.organizationId\n          }\n        };`,
    `      try {\n        const activation =\n          await officialActivator.enableForOrganization(\n            identity.organizationId,\n            packageId\n          );\n\n        return {\n          ok: true,\n          package: {\n            id: packageId,\n            status: "enabled",\n            organizationId: identity.organizationId\n          },\n          activation\n        };`,
    "platform enable route"
  );

  replaceOrThrow(
    path,
    `      const packageId = request.params.packageId;\n      organizationPackages.set(\n        identity.organizationId,\n        packageId,\n        "disabled"\n      );\n\n      if (\n        organizationPackages.countEnabled(packageId) === 0 &&\n        packageManager.isEnabled(packageId)\n      ) {\n        await packageManager.disable(packageId);\n      }\n\n      return {\n        ok: true,\n        package: {\n          id: packageId,\n          status: "disabled",\n          organizationId: identity.organizationId\n        }\n      };`,
    `      const packageId = request.params.packageId;\n      const activation =\n        await officialActivator.disableForOrganization(\n          identity.organizationId,\n          packageId\n        );\n\n      return {\n        ok: true,\n        package: {\n          id: packageId,\n          status: "disabled",\n          organizationId: identity.organizationId\n        },\n        activation\n      };`,
    "platform disable route"
  );
}

function patchRegistry() {
  const path = "packages/marketplace-registry/src/index.ts";
  replaceOrThrow(
    path,
    `  officialListing({\n    slug: "investment-analysis",`,
    `  officialListing({\n    slug: "b2b-opportunity-workflow",\n    type: "workflow",\n    displayName: "B2B Opportunity Workflow",\n    summary:\n      "Turn market signals into a business analysis and evidence-aware prospect pipeline.",\n    categories: ["sales", "business-intelligence", "workflow"],\n    tags: ["b2b", "opportunity", "strategy", "growth"]\n  }),\n  officialListing({\n    slug: "investment-analysis",`,
    "workflow marketplace seed"
  );
}

function patchMarketplaceTests() {
  const foundation = "scripts/test-marketplace-foundation.mjs";
  replaceOrThrow(
    foundation,
    `assert.equal(officialSearch.items.length, 5);`,
    `assert.equal(officialSearch.items.length, 6);`,
    "foundation listing count"
  );
  replaceOrThrow(
    foundation,
    `    "business-analysis",\n    "investment-analysis"`,
    `    "business-analysis",\n    "b2b-opportunity-workflow",\n    "investment-analysis"`,
    "foundation workflow slug"
  );
  replaceOrThrow(
    foundation,
    `assert.equal(officialMarketplaceListings.length, 5);`,
    `assert.equal(officialMarketplaceListings.length, 6);`,
    "foundation seed count"
  );

  const api = "scripts/test-marketplace-api.mjs";
  replaceOrThrow(
    api,
    `  assert.equal(all.body.items.length, 5);`,
    `  assert.equal(all.body.items.length, 6);`,
    "api listing count"
  );
  replaceOrThrow(
    api,
    `      "business-analysis",\n      "investment-analysis"`,
    `      "business-analysis",\n      "b2b-opportunity-workflow",\n      "investment-analysis"`,
    "api workflow slug"
  );
  replaceOrThrow(
    api,
    `  assert.equal(acquired.body.entitlement.status, "active");`,
    `  assert.equal(acquired.body.entitlement.status, "active");\n  assert.equal(acquired.body.activation.status, "enabled");\n  assert.equal(\n    acquired.body.activation.steps.at(-1).packageId,\n    "oeap.company-research"\n  );`,
    "api acquire activation"
  );
  replaceOrThrow(
    api,
    `  assert.equal(cancelled.body.entitlement.status, "cancelled");`,
    `  assert.equal(cancelled.body.entitlement.status, "cancelled");\n  assert.equal(cancelled.body.activation.status, "disabled");`,
    "api cancel activation"
  );
}

function patchTestCi() {
  const path = "scripts/test-ci.sh";
  replaceOrThrow(
    path,
    `run_if_present scripts/test-official-business-agents.mjs\n`,
    `run_if_present scripts/test-official-business-agents.mjs\nrun_if_present scripts/test-official-package-activator.mjs\n`,
    "test-ci activator test"
  );
}
