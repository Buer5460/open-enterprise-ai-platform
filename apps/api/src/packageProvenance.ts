import {
  createHash,
  generateKeyPairSync,
  sign,
  verify
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { runtimePath } from "./runtimePaths.js";

export type PackageProvenance = {
  schemaVersion: "1.0";
  algorithm: "Ed25519";
  packageId: string;
  version: string;
  publisher: string;
  generatedAt: string;
  publicKeyFingerprint: string;
  contentDigest: string;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  signature: string;
};

export async function signPackageDirectory(
  repoRoot: string,
  packageDirectory: string
): Promise<PackageProvenance> {
  const manifest = JSON.parse(
    await readFile(join(packageDirectory, "oeap.package.json"), "utf8")
  ) as any;
  if (!manifest?.id || !manifest?.version || !manifest?.publisher) {
    throw new Error("Package manifest is missing id, version or publisher");
  }

  const files = await hashPackageFiles(packageDirectory);
  const contentDigest = digestFileList(files);
  const keys = signingKeys(repoRoot);
  const generatedAt = new Date().toISOString();
  const payload = signingPayload({
    packageId: String(manifest.id),
    version: String(manifest.version),
    publisher: String(manifest.publisher),
    contentDigest,
    generatedAt
  });
  const signature = sign(null, Buffer.from(payload), keys.privateKey).toString("base64");

  const provenance: PackageProvenance = {
    schemaVersion: "1.0",
    algorithm: "Ed25519",
    packageId: String(manifest.id),
    version: String(manifest.version),
    publisher: String(manifest.publisher),
    generatedAt,
    publicKeyFingerprint: fingerprint(keys.publicKey),
    contentDigest,
    files,
    signature
  };

  await writeFile(
    join(packageDirectory, ".oeap-provenance.json"),
    JSON.stringify(provenance, null, 2),
    "utf8"
  );
  return provenance;
}

export async function readPackageProvenance(
  packageDirectory: string
): Promise<PackageProvenance | undefined> {
  try {
    return JSON.parse(
      await readFile(join(packageDirectory, ".oeap-provenance.json"), "utf8")
    ) as PackageProvenance;
  } catch {
    return undefined;
  }
}

export async function verifyPackageDirectory(
  repoRoot: string,
  packageDirectory: string
): Promise<{
  valid: boolean;
  reason?: string;
  provenance?: PackageProvenance;
}> {
  const provenance = await readPackageProvenance(packageDirectory);
  if (!provenance) {
    return { valid: false, reason: "Package provenance is missing" };
  }

  const files = await hashPackageFiles(packageDirectory);
  const digest = digestFileList(files);
  if (digest !== provenance.contentDigest) {
    return { valid: false, reason: "Package content digest does not match provenance", provenance };
  }

  const keys = signingKeys(repoRoot);
  if (fingerprint(keys.publicKey) !== provenance.publicKeyFingerprint) {
    return { valid: false, reason: "Package was signed by another OEAP publisher key", provenance };
  }

  const payload = signingPayload({
    packageId: provenance.packageId,
    version: provenance.version,
    publisher: provenance.publisher,
    contentDigest: provenance.contentDigest,
    generatedAt: provenance.generatedAt
  });
  const valid = verify(
    null,
    Buffer.from(payload),
    keys.publicKey,
    Buffer.from(provenance.signature, "base64")
  );

  return {
    valid,
    reason: valid ? undefined : "Ed25519 signature verification failed",
    provenance
  };
}

async function hashPackageFiles(
  root: string
): Promise<Array<{ path: string; sha256: string; bytes: number }>> {
  const output: Array<{ path: string; sha256: string; bytes: number }> = [];

  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (["node_modules", ".git", "dist"].includes(entry.name)) continue;
      if (entry.name === ".oeap-provenance.json") continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const bytes = await readFile(absolute);
        output.push({
          path: relative(root, absolute).split(sep).join("/"),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length
        });
      }
    }
  }

  await walk(root);
  return output.sort((a, b) => a.path.localeCompare(b.path));
}

function digestFileList(files: Array<{ path: string; sha256: string; bytes: number }>) {
  return createHash("sha256")
    .update(files.map((item) => `${item.path}\t${item.sha256}\t${item.bytes}`).join("\n"))
    .digest("hex");
}

function signingPayload(input: {
  packageId: string;
  version: string;
  publisher: string;
  contentDigest: string;
  generatedAt: string;
}) {
  return [
    "OEAP-PROVENANCE-V1",
    input.packageId,
    input.version,
    input.publisher,
    input.contentDigest,
    input.generatedAt
  ].join("\n");
}

function signingKeys(repoRoot: string): {
  publicKey: string;
  privateKey: string;
} {
  const privatePath = runtimePath(repoRoot, "signing", "publisher-ed25519-private.pem");
  const publicPath = runtimePath(repoRoot, "signing", "publisher-ed25519-public.pem");
  mkdirSync(dirname(privatePath), { recursive: true });

  if (!existsSync(privatePath) || !existsSync(publicPath)) {
    const pair = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" }
    });
    writeFileSync(privatePath, pair.privateKey, { mode: 0o600 });
    writeFileSync(publicPath, pair.publicKey, { mode: 0o644 });
  }

  return {
    privateKey: readFileSync(privatePath, "utf8"),
    publicKey: readFileSync(publicPath, "utf8")
  };
}

function fingerprint(publicKey: string): string {
  return `sha256:${createHash("sha256").update(publicKey).digest("hex")}`;
}
