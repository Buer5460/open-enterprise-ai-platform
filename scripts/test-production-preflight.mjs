import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "oeap-preflight-test-"));
const script = join(process.cwd(), "scripts", "production-preflight.mjs");

try {
  const valid = join(root, "valid.env");
  await writeFile(
    valid,
    [
      "OEAP_DEPLOYMENT_MODE=production",
      "NODE_ENV=production",
      "OEAP_LOCAL_AUTH=disabled",
      "OEAP_GITHUB_CLIENT_ID=dummy-client-id",
      "OEAP_GITHUB_CLIENT_SECRET=dummy-client-secret",
      "OEAP_PUBLIC_WEB_URL=https://oeap.example.test",
      "OEAP_PUBLIC_API_URL=https://oeap.example.test",
      "OEAP_CORS_ORIGINS=",
      "OEAP_SESSION_TTL_HOURS=8",
      `OEAP_DATA_DIR=${root}`
    ].join("\n"),
    "utf8"
  );

  const good = run(["--env-file", valid]);
  assert.equal(
    good.status,
    0,
    `valid production preflight should pass:\n${good.output}`
  );
  assert.match(good.output, /Production preflight passed/);
  assert.doesNotMatch(
    good.output,
    /dummy-client-secret/,
    "preflight must never print secret values"
  );

  const invalid = join(root, "invalid.env");
  await writeFile(
    invalid,
    [
      "OEAP_DEPLOYMENT_MODE=production",
      "OEAP_LOCAL_AUTH=enabled",
      "OEAP_PUBLIC_WEB_URL=http://insecure.example.test",
      "OEAP_PUBLIC_API_URL=http://insecure.example.test",
      "OEAP_CORS_ORIGINS=*",
      "OEAP_SESSION_TTL_HOURS=9999",
      "OEAP_DATA_DIR=/"
    ].join("\n"),
    "utf8"
  );

  const bad = run(["--env-file", invalid]);
  assert.notEqual(
    bad.status,
    0,
    "unsafe production preflight must fail"
  );
  assert.match(bad.output, /local-auth/);
  assert.match(bad.output, /identity-provider/);
  assert.match(bad.output, /public-web-url/);
  assert.match(bad.output, /cors/);
  assert.match(bad.output, /session-ttl/);
  assert.match(bad.output, /data-dir/);

  console.log("✅ PRODUCTION PREFLIGHT TEST PASSED");
} finally {
  await rm(root, { recursive: true, force: true });
}

function run(args) {
  const result = spawnSync(
    process.execPath,
    [script, ...args],
    {
      cwd: process.cwd(),
      env: {},
      encoding: "utf8"
    }
  );
  return {
    ...result,
    output: `${result.stdout || ""}${result.stderr || ""}`
  };
}
