import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";

import {
  join
} from "node:path";

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

function safeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "package";
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

  if (
    value === "app" ||
    value === "agent" ||
    value === "skill" ||
    value === "workflow" ||
    value === "connector" ||
    value === "data-provider"
  ) {
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
  repoRoot: string
): Promise<MarketplacePackage[]> {
  const root = developerRoot(repoRoot);

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

    if (!manifest?.id || !manifest?.type) {
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
      status: "draft",
      directory:
        `.tmp/developer-packages/${entry.name}`,
      tags:
        manifest.tags ?? [manifest.type]
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
  input: DeveloperPackageInput
): Promise<MarketplacePackage> {
  const name = safeSlug(input.name);
  const publisher =
    safeSlug(input.publisher ?? "local");
  const id = `${publisher}.${name}`;
  const root = developerRoot(repoRoot);
  const directory = join(root, name);

  await mkdir(
    join(directory, "src"),
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
    join(directory, "README.md"),
    `# ${manifest.displayName}\n\n${manifest.description}\n\nCreated with OEAP Developer Studio.\n\n## Package\n\n- ID: \`${id}\`\n- Type: \`${input.type}\`\n- Version: \`0.0.1\`\n`,
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
      `.tmp/developer-packages/${name}`,
    tags: manifest.tags
  };
}

export async function deleteDeveloperPackage(
  repoRoot: string,
  packageId: string
): Promise<boolean> {
  const drafts =
    await listDeveloperPackages(repoRoot);

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
      developerRoot(repoRoot),
      directoryName
    ),
    {
      recursive: true,
      force: true
    }
  );

  return true;
}

function developerRoot(repoRoot: string) {
  return join(
    repoRoot,
    ".tmp",
    "developer-packages"
  );
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
  return `/**\n * ${manifest.displayName}\n * Generated by OEAP Developer Studio.\n */\n\nexport const manifest = ${JSON.stringify(
    manifest,
    null,
    2
  )} as const;\n\nexport const packageModule = {\n  manifest,\n  async activate() {\n    // Register your ${manifest.type} runtime here.\n  },\n  async deactivate() {\n    // Unregister runtime resources here.\n  }\n};\n`;
}
