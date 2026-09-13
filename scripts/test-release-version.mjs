import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = [
  "package.json",
  "apps/api/package.json",
  "apps/web/package.json",
  "apps/cli/package.json",
  "packages/package-spec/package.json",
  "packages/sdk/package.json"
];

const manifests = await Promise.all(
  files.map(async (file) => ({
    file,
    manifest: JSON.parse(await readFile(file, "utf8"))
  }))
);

const platformVersion = manifests[0].manifest.version;
assert.match(
  platformVersion,
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
  "platform version must be SemVer"
);

for (const { file, manifest } of manifests) {
  assert.equal(
    manifest.version,
    platformVersion,
    `${file} must use platform release version ${platformVersion}`
  );
}

const expectedTag = process.env.GITHUB_REF_TYPE === "tag"
  ? process.env.GITHUB_REF_NAME
  : undefined;

if (expectedTag) {
  assert.equal(
    expectedTag,
    `v${platformVersion}`,
    `release tag ${expectedTag} must match package version v${platformVersion}`
  );
}

console.log(`✅ RELEASE VERSION CONTRACT PASSED (${platformVersion})`);
