import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";

const tracked = execFileSync(
  "git",
  ["ls-files", "-z"],
  { encoding: "utf8" }
)
  .split("\0")
  .filter(Boolean);

const filenameViolations = [];
const contentViolations = [];

const forbiddenExtensions = new Set([
  ".sqlite",
  ".sqlite3",
  ".db",
  ".pem",
  ".p12",
  ".pfx",
  ".key",
  ".enc"
]);

const secretPatterns = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["slack-token", /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/],
  ["stripe-live-secret", /\bsk_live_[0-9A-Za-z]{20,}\b/],
  ["resend-api-key", /\bre_[0-9A-Za-z]{20,}\b/],
  ["generic-provider-key", /\bsk-[A-Za-z0-9_-]{24,}\b/]
];

for (const file of tracked) {
  const normalized = file.replaceAll("\\", "/");
  const name = basename(normalized);
  const extension = extname(name).toLowerCase();

  if (
    normalized === ".env" ||
    (/^\.env\./.test(name) && name !== ".env.example") ||
    normalized.startsWith(".tmp/") ||
    normalized.includes("/.tmp/") ||
    forbiddenExtensions.has(extension) ||
    /^(credentials|secrets)(?:\.|$)/i.test(name) ||
    /(?:^|\/)backups\//i.test(normalized)
  ) {
    filenameViolations.push(file);
    continue;
  }

  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile() || info.size > 2 * 1024 * 1024) {
    continue;
  }

  const buffer = await readFile(file).catch(() => undefined);
  if (!buffer || buffer.includes(0)) {
    continue;
  }

  const text = buffer.toString("utf8");
  for (const [kind, pattern] of secretPatterns) {
    if (pattern.test(text)) {
      contentViolations.push(`${file} (${kind})`);
    }
  }
}

assert.deepEqual(
  filenameViolations,
  [],
  `Tracked runtime/secret-like files are forbidden:\n${filenameViolations.join("\n")}`
);
assert.deepEqual(
  contentViolations,
  [],
  `Tracked files contain secret-like credential material:\n${contentViolations.join("\n")}`
);

console.log(`✅ REPOSITORY HYGIENE TEST PASSED (${tracked.length} tracked files scanned)`);
