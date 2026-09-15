import {
  readFileSync,
  writeFileSync,
  unlinkSync
} from "node:fs";

patchCatalog();
patchActivatorTest();

unlinkSync("scripts/patch-official-discovery.mjs");
unlinkSync(".github/workflows/official-discovery-patch.yml");

function replaceOrThrow(path, before, after, label) {
  let content = readFileSync(path, "utf8");
  if (!content.includes(before)) {
    throw new Error(`${label} pattern not found in ${path}`);
  }
  content = content.replace(before, after);
  writeFileSync(path, content);
}

function patchCatalog() {
  const path = "apps/api/src/platformCatalog.ts";

  replaceOrThrow(
    path,
    `function typeField(\n  source: string\n): PlatformPackageType | undefined {\n  const value = stringField(source, "type");\n\n  if (isPackageType(value)) {\n    return value;\n  }\n\n  return undefined;\n}\n`,
    `function typeField(\n  source: string\n): PlatformPackageType | undefined {\n  const value = stringField(source, "type");\n\n  if (isPackageType(value)) {\n    return value;\n  }\n\n  return undefined;\n}\n\nfunction manifestSource(\n  source: string\n): string {\n  const start = source.indexOf("definePackage({");\n  if (start < 0) {\n    return source;\n  }\n\n  const end = source.indexOf(\n    "} satisfies",\n    start\n  );\n\n  return end >= 0\n    ? source.slice(start, end + 1)\n    : source.slice(start);\n}\n`,
    "manifestSource helper"
  );

  replaceOrThrow(
    path,
    `    const type =\n      typeField(source) ??\n      inferType(entry.name);`,
    `    const manifestText =\n      manifestSource(source);\n\n    const type =\n      typeField(manifestText) ??\n      inferType(entry.name);`,
    "official manifest scoped type"
  );

  for (const key of [
    "name",
    "id",
    "displayName",
    "description",
    "version",
    "publisher"
  ]) {
    const before = `stringField(source, "${key}")`;
    const after = `stringField(manifestText, "${key}")`;
    let content = readFileSync(path, "utf8");
    if (!content.includes(before)) {
      throw new Error(`official manifest field ${key} pattern not found`);
    }
    content = content.replace(before, after);
    writeFileSync(path, content);
  }
}

function patchActivatorTest() {
  const path = "scripts/test-official-package-activator.mjs";
  replaceOrThrow(
    path,
    `import {\n  OfficialPackageActivator\n} from "../apps/api/dist/officialPackageActivator.js";`,
    `import {\n  OfficialPackageActivator\n} from "../apps/api/dist/officialPackageActivator.js";\nimport {\n  discoverOfficialPackages\n} from "../apps/api/dist/platformCatalog.js";`,
    "activator discovery import"
  );

  replaceOrThrow(
    path,
    `class FakeManager {`,
    `const discovered =\n  await discoverOfficialPackages(process.cwd());\nconst discoveredIds = new Set(\n  discovered.map((item) => item.id)\n);\nfor (const packageId of [\n  "oeap.company-research",\n  "oeap.lead-generation",\n  "oeap.opportunity-radar",\n  "oeap.business-analysis",\n  "oeap.investment-analysis",\n  "oeap.b2b-opportunity-workflow"\n]) {\n  assert.equal(\n    discoveredIds.has(packageId),\n    true,\n    \`official package discovery missing \${packageId}\`\n  );\n}\n\nclass FakeManager {`,
    "real official discovery regression test"
  );
}
