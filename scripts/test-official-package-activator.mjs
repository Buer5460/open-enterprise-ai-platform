import assert from "node:assert/strict";

import {
  OfficialPackageActivator
} from "../apps/api/dist/officialPackageActivator.js";
import {
  discoverOfficialPackages
} from "../apps/api/dist/platformCatalog.js";

const discovered =
  await discoverOfficialPackages(process.cwd());
const discoveredIds = new Set(
  discovered.map((item) => item.id)
);
for (const packageId of [
  "oeap.company-research",
  "oeap.lead-generation",
  "oeap.opportunity-radar",
  "oeap.business-analysis",
  "oeap.investment-analysis",
  "oeap.b2b-opportunity-workflow"
]) {
  assert.equal(
    discoveredIds.has(packageId),
    true,
    `official package discovery missing ${packageId}`
  );
}

class FakeManager {
  installed = new Map();
  enabled = new Set();
  order = [];

  get(id) {
    const module = this.installed.get(id);
    return module
      ? {
          manifest: module.manifest,
          status: this.enabled.has(id) ? "enabled" : "installed",
          installedAt: "now",
          updatedAt: "now"
        }
      : undefined;
  }

  async install(module) {
    this.installed.set(module.manifest.id, module);
    this.order.push(`install:${module.manifest.id}`);
    return this.get(module.manifest.id);
  }

  async enable(id) {
    this.enabled.add(id);
    this.order.push(`enable:${id}`);
    return this.get(id);
  }

  async disable(id) {
    this.enabled.delete(id);
    this.order.push(`disable:${id}`);
    return this.get(id);
  }

  isEnabled(id) {
    return this.enabled.has(id);
  }
}

class FakeStore {
  states = new Map();

  key(org, pkg) {
    return `${org}:${pkg}`;
  }

  set(org, pkg, status) {
    this.states.set(this.key(org, pkg), status);
  }

  countEnabled(pkg) {
    return [...this.states.entries()].filter(
      ([key, status]) =>
        key.endsWith(`:${pkg}`) && status === "enabled"
    ).length;
  }
}

function runtimeModule(id, version, dependencies = []) {
  return {
    manifest: {
      schemaVersion: "1.0",
      id,
      type: id.includes("workflow") ? "workflow" : "agent",
      name: id.split(".").at(-1),
      version,
      publisher: "oeap",
      dependencies,
      ...(id.includes("workflow") ? { steps: [] } : {})
    }
  };
}

const modules = new Map([
  ["oeap.ai-generate", runtimeModule("oeap.ai-generate", "0.0.1")],
  [
    "oeap.business-analysis",
    runtimeModule(
      "oeap.business-analysis",
      "0.1.0",
      [{ package: "oeap.ai-generate", version: ">=0.0.1" }]
    )
  ],
  [
    "oeap.b2b-opportunity-workflow",
    runtimeModule(
      "oeap.b2b-opportunity-workflow",
      "0.1.0",
      [{ package: "oeap.business-analysis", version: ">=0.1.0" }]
    )
  ]
]);
const catalog = [...modules.values()].map((module) => ({
  id: module.manifest.id,
  version: module.manifest.version,
  directory: `packages/official/${module.manifest.name}`
}));
const manager = new FakeManager();
const store = new FakeStore();
const activator = new OfficialPackageActivator(".", {
  manager,
  organizationPackages: store,
  catalog: async () => catalog,
  loadModule: async (id) => {
    const module = modules.get(id);
    if (!module) throw new Error(`missing ${id}`);
    return module;
  },
  satisfies: (version, range) => {
    if (range === ">=0.0.1") return version === "0.0.1" || version.startsWith("0.1.");
    if (range === ">=0.1.0") return version.startsWith("0.1.");
    return version === range;
  }
});

assert.equal(
  await activator.hasOfficialPackage("oeap.business-analysis"),
  true
);
assert.equal(
  await activator.hasOfficialPackage("third.party"),
  false
);

const result = await activator.enableForOrganization(
  "org-a",
  "oeap.b2b-opportunity-workflow"
);
assert.deepEqual(
  result.steps.map((step) => step.packageId),
  [
    "oeap.ai-generate",
    "oeap.business-analysis",
    "oeap.b2b-opportunity-workflow"
  ]
);
assert.ok(
  manager.order.indexOf("enable:oeap.ai-generate") <
  manager.order.indexOf("enable:oeap.business-analysis")
);
assert.equal(
  store.states.get("org-a:oeap.ai-generate"),
  "enabled"
);

const second = await activator.enableForOrganization(
  "org-b",
  "oeap.business-analysis"
);
assert.equal(
  second.steps.at(-1).status,
  "already-enabled"
);
assert.equal(
  store.states.get("org-b:oeap.business-analysis"),
  "enabled"
);

const disabledA = await activator.disableForOrganization(
  "org-a",
  "oeap.business-analysis"
);
assert.equal(disabledA.globallyDisabled, false);
const disabledB = await activator.disableForOrganization(
  "org-b",
  "oeap.business-analysis"
);
assert.equal(disabledB.globallyDisabled, true);

const missingManager = new FakeManager();
const missingStore = new FakeStore();
const missingActivator = new OfficialPackageActivator(".", {
  manager: missingManager,
  organizationPackages: missingStore,
  catalog: async () => [
    {
      id: "oeap.requires-missing",
      version: "1.0.0",
      directory: "x"
    }
  ],
  loadModule: async () =>
    runtimeModule(
      "oeap.requires-missing",
      "1.0.0",
      [{ package: "oeap.nope", version: "1.0.0" }]
    ),
  satisfies: () => true
});
await assert.rejects(
  missingActivator.enableForOrganization(
    "org-a",
    "oeap.requires-missing"
  ),
  /Required package dependency not found/
);

const versionActivator = new OfficialPackageActivator(".", {
  manager: new FakeManager(),
  organizationPackages: new FakeStore(),
  catalog: async () => [
    { id: "oeap.root", version: "1.0.0", directory: "root" },
    { id: "oeap.dep", version: "1.0.0", directory: "dep" }
  ],
  loadModule: async (id) =>
    id === "oeap.root"
      ? runtimeModule(
          "oeap.root",
          "1.0.0",
          [{ package: "oeap.dep", version: ">=2.0.0" }]
        )
      : runtimeModule("oeap.dep", "1.0.0"),
  satisfies: () => false
});
await assert.rejects(
  versionActivator.enableForOrganization("org", "oeap.root"),
  /version mismatch/
);

const cycleModules = new Map([
  [
    "oeap.a",
    runtimeModule("oeap.a", "1.0.0", [
      { package: "oeap.b", version: "1.0.0" }
    ])
  ],
  [
    "oeap.b",
    runtimeModule("oeap.b", "1.0.0", [
      { package: "oeap.a", version: "1.0.0" }
    ])
  ]
]);
const cycleActivator = new OfficialPackageActivator(".", {
  manager: new FakeManager(),
  organizationPackages: new FakeStore(),
  catalog: async () => [...cycleModules.values()].map((module) => ({
    id: module.manifest.id,
    version: module.manifest.version,
    directory: module.manifest.id
  })),
  loadModule: async (id) => cycleModules.get(id),
  satisfies: () => true
});
await assert.rejects(
  cycleActivator.enableForOrganization("org", "oeap.a"),
  /dependency cycle detected/
);

console.log("✅ OFFICIAL PACKAGE ACTIVATOR TEST PASSED");
