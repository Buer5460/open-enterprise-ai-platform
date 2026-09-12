import {
  createDeveloperPackage,
  deleteDeveloperPackage,
  listDeveloperPackages
} from "../apps/api/dist/platformCatalog.js";

import {
  resolve
} from "node:path";

const repoRoot = resolve(".");
const packageName =
  `ci-studio-skill-${Date.now()}`;
const packageId =
  `ci.${packageName}`;

const created =
  await createDeveloperPackage(
    repoRoot,
    {
      type: "skill",
      name: packageName,
      displayName:
        "CI Developer Studio Skill",
      description:
        "Deterministic Developer Studio lifecycle test.",
      publisher: "ci"
    }
  );

if (created.id !== packageId) {
  throw new Error(
    `Unexpected package id: ${created.id}`
  );
}

const afterCreate =
  await listDeveloperPackages(repoRoot);

if (
  !afterCreate.some(
    (item) => item.id === packageId
  )
) {
  throw new Error(
    "Developer package was not discoverable after creation"
  );
}

const deleted =
  await deleteDeveloperPackage(
    repoRoot,
    packageId
  );

if (!deleted) {
  throw new Error(
    "Developer package delete returned false"
  );
}

const afterDelete =
  await listDeveloperPackages(repoRoot);

if (
  afterDelete.some(
    (item) => item.id === packageId
  )
) {
  throw new Error(
    "Developer package still exists after deletion"
  );
}

console.log(
  "✅ DEVELOPER STUDIO LIFECYCLE TEST PASSED"
);
