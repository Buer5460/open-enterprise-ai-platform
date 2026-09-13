import assert from "node:assert/strict";
import {
  CURRENT_PACKAGE_SCHEMA,
  isPackageUpgradeCompatible,
  validatePackageCompatibility
} from "../packages/package-spec/dist/index.js";

const valid = validatePackageCompatibility({
  schemaVersion: CURRENT_PACKAGE_SCHEMA,
  id: "example.skill",
  type: "skill",
  name: "example-skill",
  version: "1.2.3",
  publisher: "example"
});
assert.equal(valid.compatible, true);
assert.equal(valid.issues.some((item) => item.severity === "error"), false);

const forwardMinor = validatePackageCompatibility({
  schemaVersion: "1.1",
  id: "example.skill",
  type: "skill",
  name: "example-skill",
  version: "1.2.3",
  publisher: "example",
  futureOptionalField: true
});
assert.equal(forwardMinor.compatible, true);
assert.equal(
  forwardMinor.issues.some((item) => item.code === "schema.newer-minor"),
  true
);

const unsupported = validatePackageCompatibility({
  schemaVersion: "2.0",
  id: "example.skill",
  type: "skill",
  name: "example-skill",
  version: "2.0.0",
  publisher: "example"
});
assert.equal(unsupported.compatible, false);
assert.equal(
  unsupported.issues.some((item) => item.code === "schema.unsupported-major"),
  true
);

assert.equal(isPackageUpgradeCompatible("1.2.0", "1.3.0"), true);
assert.equal(isPackageUpgradeCompatible("1.2.0", "1.1.9"), false);
assert.equal(isPackageUpgradeCompatible("1.2.0", "2.0.0"), false);

console.log("✅ PACKAGE COMPATIBILITY TEST PASSED");
