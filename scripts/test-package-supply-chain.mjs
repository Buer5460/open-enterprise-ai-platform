import {
  mkdtemp,
  mkdir,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  signPackageDirectory,
  verifyPackageDirectory,
  verifyPackageWithEmbeddedKey
} from "../apps/api/dist/packageProvenance.js";
import {
  scanPackageDirectory
} from "../apps/api/dist/packageSecurity.js";

const root = await mkdtemp(
  join(tmpdir(), "oeap-supply-chain-")
);
const runtime = join(root, "runtime");
const safePackage = join(root, "safe-package");
const unsafePackage = join(root, "unsafe-package");

try {
  await createPackage(safePackage, {
    id: "test.safe-skill",
    type: "skill",
    name: "safe-skill",
    version: "1.0.0",
    publisher: "test",
    source:
      "export const manifest = {}; export async function runSkill(input) { return input; }"
  });

  const safeScan = await scanPackageDirectory(
    safePackage
  );
  assert(
    safeScan.valid,
    `safe package should pass static scan: ${JSON.stringify(safeScan.findings)}`
  );

  const provenance = await signPackageDirectory(
    runtime,
    safePackage,
    "org_alpha"
  );

  const sameOrg = await verifyPackageDirectory(
    runtime,
    safePackage,
    "org_alpha"
  );
  assert(
    sameOrg.valid,
    `same organization must verify its package: ${sameOrg.reason ?? "unknown"}`
  );

  const anotherOrg = await verifyPackageDirectory(
    runtime,
    safePackage,
    "org_beta"
  );
  assert(
    !anotherOrg.valid,
    "another organization key must not be treated as the local signer"
  );

  const trustedPortable =
    await verifyPackageWithEmbeddedKey(
      safePackage,
      [provenance.publicKeyFingerprint]
    );
  assert(
    trustedPortable.valid && trustedPortable.trusted,
    "embedded Ed25519 key must verify when its fingerprint is explicitly trusted"
  );

  const untrustedPortable =
    await verifyPackageWithEmbeddedKey(
      safePackage,
      []
    );
  assert(
    untrustedPortable.valid && !untrustedPortable.trusted,
    "a valid remote signature must remain untrusted without an allowlisted fingerprint"
  );

  await writeFile(
    join(safePackage, "src", "tampered.ts"),
    "export const tampered = true;\n",
    "utf8"
  );
  const tampered = await verifyPackageWithEmbeddedKey(
    safePackage,
    [provenance.publicKeyFingerprint]
  );
  assert(
    !tampered.valid,
    "content changes after signing must invalidate provenance"
  );

  await createPackage(unsafePackage, {
    id: "test.unsafe-skill",
    type: "skill",
    name: "unsafe-skill",
    version: "1.0.0",
    publisher: "test",
    source:
      'import { execSync } from "node:child_process"; export function run(){ return execSync("whoami"); }'
  });

  const unsafeScan = await scanPackageDirectory(
    unsafePackage
  );
  assert(
    !unsafeScan.valid,
    "package with operating-system process execution must be rejected"
  );
  assert(
    unsafeScan.findings.some(
      (finding) => finding.code === "source.process_execution"
    ),
    "process execution finding should be present"
  );

  console.log(
    "✅ PACKAGE SUPPLY-CHAIN SECURITY TEST PASSED"
  );
} finally {
  await rm(root, {
    recursive: true,
    force: true
  });
}

async function createPackage(directory, input) {
  await mkdir(join(directory, "src"), {
    recursive: true
  });
  await writeFile(
    join(directory, "oeap.package.json"),
    JSON.stringify(
      {
        schemaVersion: "1.0",
        id: input.id,
        type: input.type,
        name: input.name,
        displayName: input.name,
        version: input.version,
        publisher: input.publisher,
        dependencies: []
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    join(directory, "src", "index.ts"),
    `${input.source}\n`,
    "utf8"
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
