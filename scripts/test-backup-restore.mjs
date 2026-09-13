import assert from "node:assert/strict";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "oeap-backup-test-"));
const dataDir = join(root, "data");
const backup = join(root, "oeap-test.tar.gz");
const backupScript = join(process.cwd(), "scripts", "backup-data.sh");
const restoreScript = join(process.cwd(), "scripts", "restore-data.sh");
const port = String(61000 + Math.floor(Math.random() * 3000));

const env = {
  ...process.env,
  OEAP_DATA_DIR: dataDir,
  OEAP_BACKUP_DIR: root,
  OEAP_API_PORT: port
};

try {
  await mkdir(join(dataDir, "tenancy"), { recursive: true });
  await mkdir(join(dataDir, "settings"), { recursive: true });
  await writeFile(
    join(dataDir, "tenancy", "fixture.txt"),
    "tenant-state-v1",
    "utf8"
  );
  await writeFile(
    join(dataDir, "settings", "fixture.txt"),
    "encrypted-settings-placeholder",
    "utf8"
  );

  const backupResult = run(backupScript, [backup], env);
  assert.equal(
    backupResult.status,
    0,
    `backup failed:\n${backupResult.output}`
  );
  assert.equal(
    await readFile(`${backup}.sha256`, "utf8").then((v) => /^[a-f0-9]{64}\s+/.test(v.trim())),
    true,
    "backup must produce a SHA-256 sidecar"
  );

  const insideBackup = join(dataDir, "invalid.tar.gz");
  const insideResult = run(backupScript, [insideBackup], env);
  assert.notEqual(
    insideResult.status,
    0,
    "backup target inside OEAP_DATA_DIR must be rejected"
  );

  await writeFile(
    join(dataDir, "tenancy", "fixture.txt"),
    "mutated",
    "utf8"
  );
  await writeFile(join(dataDir, "extra.txt"), "remove-me", "utf8");

  const restoreResult = run(restoreScript, [backup], env);
  assert.equal(
    restoreResult.status,
    0,
    `restore failed:\n${restoreResult.output}`
  );
  assert.equal(
    await readFile(join(dataDir, "tenancy", "fixture.txt"), "utf8"),
    "tenant-state-v1",
    "restore must recover the original data"
  );
  await assert.rejects(
    () => readFile(join(dataDir, "extra.txt"), "utf8"),
    "restore must replace files that were not part of the backup"
  );

  const tampered = join(root, "tampered.tar.gz");
  await copyFile(backup, tampered);
  await copyFile(`${backup}.sha256`, `${tampered}.sha256`);
  await appendFile(tampered, Buffer.from("tamper"));
  const tamperedResult = run(restoreScript, [tampered], env);
  assert.notEqual(
    tamperedResult.status,
    0,
    "tampered backup must fail SHA-256 validation"
  );

  if (isGnuTar()) {
    const payloadDir = join(root, "malicious-src");
    const payload = join(payloadDir, "payload.txt");
    const malicious = join(root, "malicious.tar.gz");
    await mkdir(payloadDir, { recursive: true });
    await writeFile(payload, "escape", "utf8");

    const tarResult = spawnSync(
      "tar",
      [
        "-czf",
        malicious,
        "--transform=s#^payload.txt$#../escaped-by-archive.txt#",
        "-C",
        payloadDir,
        "payload.txt"
      ],
      { encoding: "utf8" }
    );

    assert.equal(
      tarResult.status,
      0,
      `failed to construct malicious archive fixture: ${tarResult.stderr}`
    );

    const maliciousResult = run(restoreScript, [malicious], env);
    assert.notEqual(
      maliciousResult.status,
      0,
      "path-traversal backup must be rejected"
    );
    await assert.rejects(
      () => readFile(join(root, "escaped-by-archive.txt"), "utf8"),
      "malicious archive must not write outside OEAP_DATA_DIR"
    );
  }

  console.log("✅ BACKUP / RESTORE SECURITY TEST PASSED");
} finally {
  await rm(root, { recursive: true, force: true });
}

function run(script, args, environment) {
  const result = spawnSync("bash", [script, ...args], {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8"
  });
  return {
    ...result,
    output: `${result.stdout || ""}${result.stderr || ""}`
  };
}

function isGnuTar() {
  const result = spawnSync("tar", ["--version"], {
    encoding: "utf8"
  });
  return result.status === 0 && /GNU tar/i.test(result.stdout || "");
}
