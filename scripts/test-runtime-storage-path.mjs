import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";

import {
  runtimeStoragePath
} from "../apps/api/dist/storagePath.js";

const originalDataDir = process.env.OEAP_DATA_DIR;
const originalCwd = process.cwd();
const alternateCwd = await mkdtemp(
  join(tmpdir(), "oeap-storage-path-")
);

try {
  const repoRoot = join(tmpdir(), "oeap-repo-root");
  const legacy = join(
    repoRoot,
    ".tmp",
    "auth",
    "sessions.sqlite"
  );

  delete process.env.OEAP_DATA_DIR;
  assert.equal(runtimeStoragePath(legacy), legacy);

  const absoluteRoot = join(
    tmpdir(),
    "oeap-absolute-data"
  );
  process.env.OEAP_DATA_DIR = absoluteRoot;
  assert.equal(
    runtimeStoragePath(legacy),
    join(absoluteRoot, "auth", "sessions.sqlite")
  );

  process.chdir(alternateCwd);
  process.env.OEAP_DATA_DIR = ".runtime-data";
  assert.equal(
    normalize(runtimeStoragePath(legacy)),
    normalize(
      join(
        repoRoot,
        ".runtime-data",
        "auth",
        "sessions.sqlite"
      )
    )
  );

  const unrelated = join(repoRoot, "state", "data.sqlite");
  assert.equal(runtimeStoragePath(unrelated), unrelated);

  console.log("✅ RUNTIME STORAGE PATH TEST PASSED");
} finally {
  process.chdir(originalCwd);
  if (originalDataDir === undefined) {
    delete process.env.OEAP_DATA_DIR;
  } else {
    process.env.OEAP_DATA_DIR = originalDataDir;
  }
  await rm(alternateCwd, {
    recursive: true,
    force: true
  });
}
