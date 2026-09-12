import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";

import {
  join
} from "node:path";

import {
  runtimePath
} from "./runtimePaths.js";

export type PlatformPackageType =
  | "app"
  | "agent"
  | "skill"
  | "workflow"
  | "connector"
  | "data-provider";

export interface MarketplacePackage {
  id: string;
  type: PlatformPackageType;
  name: string;
  displayName: string;
  description?: string;
  version: string;
  publisher: string;
  source: "official" | "generated" | "developer";
  status: "available" | "enabled" | "draft";
  directory?: string;
  tags?: string[];
}

export interface DeveloperPackageInput {
  type: PlatformPackageType;
  name: string;
  displayName?: string;
  description?: string;
  publisher?: string;
}

export interface DeveloperPackageValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  package?: MarketplacePackage;
}

function safeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "package";
}

function safeOrganizationId(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "_") || "org_local";
}

function stringField(
  source: string,
  key: string
): string | undefined {
  const match = source.match(
    new RegExp(`${key}\\s*:\\s*[\"']([^\"']+)[\"']`)
  );

  return match?.[1];
}

function typeField(
  source: string
): PlatformPackageType | undefined {
  const value = stringField(source, "type");

  if (isPackageType(value)) {
    return value;
  }

  return undefined;
}

async function readJson(
  path: string
): Promise<any | undefined> {
  try {
    return JSON.parse(
      await readFile(path, "utf8")
    );
  } catch {
    return undefined;
  }
}

export async function discoverOfficialPackages(
  repoRoot: string
): Promise<MarketplacePackage[]> {
  const root =
    join(repoRoot, "packages", "official");

  let entries;

  try {
    entries = await readdir(
      root,
      { withFileTypes: true }
    );
  } catch {
    return [];
  }

  const packages: MarketplacePackage[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory =
      join(root, entry.name);

    const pkg = await readJson(
      join(directory, "package.json")
    );

    let source = "";

    try {
      source = await readFile(
        join(directory, "src", "index.ts"),
        "utf8"
      );
    } catch {
      // Package source is optional for catalog discovery.
    }

    const type =
      typeField(source) ??
      inferType(entry.name);

    if (!type) {
      continue;
    }

    const name =
      stringField(source, "name") ??
      entry.name;

    packages.push({
      id:
        stringField(source, "id") ??
        `oeap.${entry.name}`,
      type,
      name,
      displayName:
        stringField(source, "displayName") ??
        humanize(name),
      description:
        stringField(source, "description") ??
        undefined,
      version:
        stringField(source, "version") ??
        pkg?.version ??
        "0.0.1",
      publisher:
        stringField(source, "publisher") ??
        "oeap",
      source: "official",
      status: "available",
      directory:
        `packages/official/${entry.name}`,
      tags: [type, "official"]
    });
  }

  return packages.sort(
    (a, b) =>
      a.displayName.localeCompare(
        b.displayName
      )
  );
}

export async function listDeveloperPackages(
  repoRoot: string,
  organizationId = "org_local"
): Promise<MarketplacePackage[]> {
  return listPackagesFromRoot(
    developerRoot(repoRoot, organizationId),
    "draft",
    displayPrefix(organizationId, "developer-packages")
  );
}

export async function listPublishedPackages(
  repoRoot: string,
  organizationId = "org_local"
): Promise<MarketplacePackage[]> {
  return listPackagesFromRoot(
    marketplaceRoot(repoRoot, organizationId),
    "available",
    displayPrefix(organizationId, "marketplace-packages")
  );
}

export async function publishedPackageDirectory(
  repoRoot: string,
  organizationId: string,
  packageId: string
): Promise<string | undefined> {
  const published = await listPublishedPackages(
    repoRoot,
    organizationId
  );
  const item = published.find(
    (candidate) => candidate.id === packageId
  );
  const directoryName =
    item?.directory?.split("/").pop();

  return directoryName
    ? join(
        marketplaceRoot(repoRoot, organizationId),
        directoryName
      )
    : undefined;
}

async function listPackagesFromRoot(
  root: string,
  status: "draft" | "available",
  directoryPrefix: string
): Promise<MarketplacePackage[]> {
  let entries;

  try {
    entries = await readdir(
      root,
      { withFileTypes: true }
    );
  } catch {
    return [];
  }

  const result: MarketplacePackage[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifest = await readJson(
      join(
        root,
        entry.name,
        "oeap.package.json"
      )
    );

    if (
      !manifest?.id ||
      !isPackageType(manifest?.type)
    ) {
      continue;
    }

    result.push({
      id: manifest.id,
      type: manifest.type,
      name: manifest.name,
      displayName:
        manifest.displayName ??
        manifest.name,
      description:
        manifest.description,
      version:
        manifest.version ?? "0.0.1",
      publisher:
        manifest.publisher ?? "local",
      source: "developer",
      status,
      directory:
        `${directoryPrefix}/${entry.name}`,
      tags:
        manifest.tags ?? [
          manifest.type,
          status === "draft"
            ? "developer-studio"
            : "published"
        ]
    });
  }

  return result.sort(
    (a, b) =>
      a.displayName.localeCompare(
        b.displayName
      )
  );
}

export async function createDeveloperPackage(
  repoRoot: string,
  input: DeveloperPackageInput,
  organizationId = "org_local"
): Promise<MarketplacePackage> {
  const name = safeSlug(input.name);
  const publisher =
    safeSlug(input.publisher ?? "local");
  const id = `${publisher}.${name}`;
  const root = developerRoot(repoRoot, organizationId);
  const directory = join(root, name);

  await mkdir(
    join(directory, "src"),
    { recursive: true }
  );

  await mkdir(
    join(directory, "tests"),
    { recursive: true }
  );

  const manifest = {
    schemaVersion: "1.0",
    id,
    type: input.type,
    name,
    displayName:
      input.displayName?.trim() ||
      humanize(name),
    description:
      input.description?.trim() ||
      `${humanize(input.type)} package created with OEAP Developer Studio.`,
    version: "0.0.1",
    publisher,
    license: "Apache-2.0",
    tags: [
      input.type,
      "developer-studio"
    ]
  };

  await writeFile(
    join(directory, "oeap.package.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  await writeFile(
    join(directory, "package.json"),
    JSON.stringify(
      {
        name: `@${publisher}/${name}`,
        version: "0.0.1",
        private: false,
        type: "module",
        scripts: {
          test: "node tests/smoke.mjs"
        },
        oeap: {
          manifest: "./oeap.package.json"
        }
      },
      null,
      2
    ),
    "utf8"
  );

  await writeFile(
    join(directory, "src", "index.ts"),
    starterSource(manifest),
    "utf8"
  );

  await writeFile(
    join(directory, "tests", "smoke.mjs"),
    `import { readFile } from "node:fs/promises";\n\nconst manifest = JSON.parse(\n  await readFile(new URL("../oeap.package.json", import.meta.url), "utf8")\n);\n\nif (!manifest.id || !manifest.type || !manifest.version) {\n  throw new Error("Invalid OEAP manifest");\n}\n\nconsole.log("✅ OEAP PACKAGE SMOKE TEST PASSED", manifest.id);\n`,
    "utf8"
  );

  await writeFile(
    join(directory, "README.md"),
    `# ${manifest.displayName}\n\n${manifest.description}\n\nCreated with OEAP Developer Studio.\n\n## Package\n\n- ID: \`${id}\`\n- Type: \`${input.type}\`\n- Version: \`0.0.1\`\n- Publisher: \`${publisher}\`\n\n## Lifecycle\n\n1. Edit \`src/index.ts\`\n2. Validate in Developer Studio\n3. Publish to the local Marketplace\n4. Sign and verify package provenance\n5. Connect a GitHub publisher to push the package to a remote repository\n`,
    "utf8"
  );

  return {
    id,
    type: input.type,
    name,
    displayName: manifest.displayName,
    description: manifest.description,
    version: "0.0.1",
    publisher,
    source: "developer",
    status: "draft",
    directory:
      `${displayPrefix(organizationId, "developer-packages")}/${name}`,
    tags: manifest.tags
  };
}

export async function validateDeveloperPackage(
  repoRoot: string,
  packageId: string,
  organizationId = "org_local"
): Promise<DeveloperPackageValidation> {
  const drafts =
    await listDeveloperPackages(
      repoRoot,
      organizationId
    );

  const found = drafts.find(
    (item) => item.id === packageId
  );

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!found?.directory) {
    return {
      valid: false,
      errors: [
        `Developer package not found: ${packageId}`
      ],
      warnings
    };
  }

  const directoryName =
    found.directory.split("/").pop();

  if (!directoryName) {
    return {
      valid: false,
      errors: ["Invalid developer package directory"],
      warnings
    };
  }

  const directory = join(
    developerRoot(repoRoot, organizationId),
    directoryName
  );

  const manifest = await readJson(
    join(directory, "oeap.package.json")
  );

  const pkg = await readJson(
    join(directory, "package.json")
  );

  let source = "";
  try {
    source = await readFile(
      join(directory, "src", "index.ts"),
      "utf8"
    );
  } catch {
    errors.push("Missing src/index.ts");
  }

  if (!manifest) {
    errors.push("Missing or invalid oeap.package.json");
  } else {
    if (manifest.schemaVersion !== "1.0") {
      errors.push("schemaVersion must be 1.0");
    }

    if (!manifest.id || manifest.id !== packageId) {
      errors.push("Manifest id does not match package id");
    }

    if (!isPackageType(manifest.type)) {
      errors.push("Unsupported OEAP package type");
    }

    if (!manifest.name) {
      errors.push("Manifest name is required");
    }

    if (!manifest.publisher) {
      errors.push("Manifest publisher is required");
    }

    if (
      !manifest.version ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
        manifest.version
      )
    ) {
      errors.push("Manifest version must be semantic version format");
    }
  }

  if (!pkg) {
    errors.push("Missing or invalid package.json");
  } else {
    if (!pkg.name) {
      errors.push("package.json name is required");
    }

    if (pkg.type !== "module") {
      warnings.push("package.json type should be module");
    }
  }

  if (source) {
    if (!source.includes("manifest")) {
      errors.push("src/index.ts must export a manifest");
    }

    if (!source.includes("packageModule")) {
      warnings.push(
        "src/index.ts does not export packageModule; runtime activation may not be available"
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    package: found
  };
}

export async function publishDeveloperPackage(
  repoRoot: string,
  packageId: string,
  organizationId = "org_local"
): Promise<MarketplacePackage> {
  const validation =
    await validateDeveloperPackage(
      repoRoot,
      packageId,
      organizationId
    );

  if (!validation.valid || !validation.package) {
    throw new Error(
      validation.errors.join("; ") ||
      "Developer package validation failed"
    );
  }

  const draft = validation.package;
  const directoryName =
    draft.directory?.split("/").pop();

  if (!directoryName) {
    throw new Error(
      "Developer package directory is invalid"
    );
  }

  const sourceDirectory = join(
    developerRoot(repoRoot, organizationId),
    directoryName
  );

  const targetDirectory = join(
    marketplaceRoot(repoRoot, organizationId),
    directoryName
  );

  await mkdir(
    marketplaceRoot(repoRoot, organizationId),
    { recursive: true }
  );

  await rm(
    targetDirectory,
    {
      recursive: true,
      force: true
    }
  );

  await cp(
    sourceDirectory,
    targetDirectory,
    {
      recursive: true
    }
  );

  await writeFile(
    join(
      targetDirectory,
      "publication.json"
    ),
    JSON.stringify(
      {
        packageId,
        organizationId,
        publishedAt:
          new Date().toISOString(),
        channel: "local-marketplace",
        github: {
          status: "not-configured",
          note:
            "Use a GitHub publisher connector; never store tokens in package source."
        }
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    ...draft,
    status: "available",
    directory:
      `${displayPrefix(organizationId, "marketplace-packages")}/${directoryName}`,
    tags: [
      ...(draft.tags ?? []),
      "published"
    ]
  };
}

export async function unpublishDeveloperPackage(
  repoRoot: string,
  packageId: string,
  organizationId = "org_local"
): Promise<boolean> {
  const published =
    await listPublishedPackages(
      repoRoot,
      organizationId
    );

  const found = published.find(
    (item) => item.id === packageId
  );

  const directoryName =
    found?.directory?.split("/").pop();

  if (!directoryName) {
    return false;
  }

  await rm(
    join(
      marketplaceRoot(repoRoot, organizationId),
      directoryName
    ),
    {
      recursive: true,
      force: true
    }
  );

  return true;
}

export async function deleteDeveloperPackage(
  repoRoot: string,
  packageId: string,
  organizationId = "org_local"
): Promise<boolean> {
  const drafts =
    await listDeveloperPackages(
      repoRoot,
      organizationId
    );

  const found = drafts.find(
    (item) => item.id === packageId
  );

  if (!found?.directory) {
    return false;
  }

  const directoryName =
    found.directory.split("/").pop();

  if (!directoryName) {
    return false;
  }

  await rm(
    join(
      developerRoot(repoRoot, organizationId),
      directoryName
    ),
    {
      recursive: true,
      force: true
    }
  );

  return true;
}

function developerRoot(
  repoRoot: string,
  organizationId: string
) {
  return organizationId === "org_local"
    ? runtimePath(repoRoot, "developer-packages")
    : runtimePath(
        repoRoot,
        "organizations",
        safeOrganizationId(organizationId),
        "developer-packages"
      );
}

function marketplaceRoot(
  repoRoot: string,
  organizationId: string
) {
  return organizationId === "org_local"
    ? runtimePath(repoRoot, "marketplace-packages")
    : runtimePath(
        repoRoot,
        "organizations",
        safeOrganizationId(organizationId),
        "marketplace-packages"
      );
}

function displayPrefix(
  organizationId: string,
  kind: "developer-packages" | "marketplace-packages"
): string {
  return organizationId === "org_local"
    ? `.tmp/${kind}`
    : `.tmp/organizations/${safeOrganizationId(organizationId)}/${kind}`;
}

function inferType(
  name: string
): PlatformPackageType | undefined {
  if (name.includes("agent")) {
    return "agent";
  }

  if (name.includes("skill")) {
    return "skill";
  }

  if (name.includes("workflow")) {
    return "workflow";
  }

  if (name.includes("connector")) {
    return "connector";
  }

  if (name.includes("provider")) {
    return "data-provider";
  }

  return undefined;
}

function isPackageType(
  value: unknown
): value is PlatformPackageType {
  return [
    "app",
    "agent",
    "skill",
    "workflow",
    "connector",
    "data-provider"
  ].includes(String(value));
}

function humanize(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) =>
      char.toUpperCase()
    );
}

function starterSource(manifest: {
  id: string;
  type: PlatformPackageType;
  name: string;
  displayName: string;
  description: string;
  version: string;
  publisher: string;
}) {
  const manifestJson = JSON.stringify(
    manifest,
    null,
    2
  );

  const typeBody: Record<
    PlatformPackageType,
    string
  > = {
    app:
      `export async function startApp() {\n  return { ok: true, appId: manifest.id };\n}`,
    agent:
      `export async function executeAgent(input: unknown) {\n  return { ok: true, input };\n}`,
    skill:
      `export async function runSkill(input: unknown) {\n  return { ok: true, input };\n}`,
    workflow:
      `export async function runWorkflow(input: unknown) {\n  return { ok: true, steps: [], input };\n}`,
    connector:
      `export async function executeConnector(capability: string, input: unknown) {\n  return { ok: true, capability, input };\n}`,
    "data-provider":
      `export async function queryData(query: unknown) {\n  return { ok: true, rows: [], query };\n}`
  };

  return `/**\n * ${manifest.displayName}\n * Generated by OEAP Developer Studio.\n */\n\nexport const manifest = ${manifestJson} as const;\n\n${typeBody[manifest.type]}\n\nexport const packageModule = {\n  manifest,\n  async activate() {\n    // Register your ${manifest.type} runtime resources here.\n  },\n  async deactivate() {\n    // Unregister runtime resources here.\n  }\n};\n`;
}
