import {
  createDeveloperPackage,
  deleteDeveloperPackage,
  listDeveloperPackages,
  listPublishedPackages,
  publishDeveloperPackage,
  unpublishDeveloperPackage,
  validateDeveloperPackage
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

const validation =
  await validateDeveloperPackage(
    repoRoot,
    packageId
  );

if (!validation.valid) {
  throw new Error(
    `Developer package validation failed: ${validation.errors.join(", ")}`
  );
}

const published =
  await publishDeveloperPackage(
    repoRoot,
    packageId
  );

if (
  published.id !== packageId ||
  published.status !== "available"
) {
  throw new Error(
    "Developer package publish returned unexpected result"
  );
}

const marketplace =
  await listPublishedPackages(repoRoot);

if (
  !marketplace.some(
    (item) => item.id === packageId
  )
) {
  throw new Error(
    "Published package was not discoverable in local marketplace"
  );
}

const unpublished =
  await unpublishDeveloperPackage(
    repoRoot,
    packageId
  );

if (!unpublished) {
  throw new Error(
    "Developer package unpublish returned false"
  );
}

const afterUnpublish =
  await listPublishedPackages(repoRoot);

if (
  afterUnpublish.some(
    (item) => item.id === packageId
  )
) {
  throw new Error(
    "Developer package still exists in local marketplace after unpublish"
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
  "✅ DEVELOPER STUDIO VALIDATE/PUBLISH LIFECYCLE TEST PASSED"
);
