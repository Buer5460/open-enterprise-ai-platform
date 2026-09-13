import assert from "node:assert/strict";

import {
  satisfiesSemverRange
} from "../apps/api/dist/semverRange.js";

const yes = [
  ["1.2.3", "1.2.3"],
  ["1.9.9", "^1.2.3"],
  ["0.2.9", "^0.2.0"],
  ["0.0.3", "^0.0.3"],
  ["1.2.9", "~1.2.3"],
  ["1.8.0", ">=1.2.0 <2.0.0"],
  ["2.4.0", "^1.5.0 || ^2.0.0"],
  ["1.7.4", "1.x"],
  ["1.2.8", "1.2.x"],
  ["3.0.0", "*"],
  ["3.0.0", "latest"],
  ["1.2.3-beta.2", ">=1.2.3-beta.1 <1.2.3"]
];

const no = [
  ["2.0.0", "^1.2.3"],
  ["0.3.0", "^0.2.0"],
  ["0.0.4", "^0.0.3"],
  ["1.3.0", "~1.2.3"],
  ["2.0.0", ">=1.2.0 <2.0.0"],
  ["3.0.0", "^1.5.0 || ^2.0.0"],
  ["2.0.0", "1.x"],
  ["1.3.0", "1.2.x"],
  ["1.2.3", "not-a-range"],
  ["1.2", ">=1.0.0"]
];

for (const [version, range] of yes) {
  assert.equal(
    satisfiesSemverRange(version, range),
    true,
    `${version} should satisfy ${range}`
  );
}

for (const [version, range] of no) {
  assert.equal(
    satisfiesSemverRange(version, range),
    false,
    `${version} should not satisfy ${range}`
  );
}

console.log("✅ PACKAGE SEMVER RANGE TEST PASSED");
