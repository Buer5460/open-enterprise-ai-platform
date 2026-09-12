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
  signerOrganizationId?: string;
  generatedAt: string;
  publicKeyFingerprint: string;
  publicKey?: string;
  contentDigest: string;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  signature: string;
};

export async function signPackageDirectory(
  repoRoot: string,
  packageDirectory: string,
  organizationId = "org_local"
): Promise<PackageProvenance> {
  const manifest = JSON.parse(
    await readFile(join(packageDirectory, "oeap.package.json"), "utf8")
  ) as any;
  if (!manifest?.id || !manifest?.version || !manifest?.publisher) {
    throw new Error("Package manifest is missing id, version or publisher");
  }

  const files = await hashPackageFiles(packageDirectory);
  const contentDigest = digestFileList(files);
  const keys = signingKeys(repoRoot, organizationId);
  const generatedAt = new Date().toISOString();
  const payload = signingPayload({
    packageId: String(manifest.id),
    version: String(manifest.version),
    publisher: String(manifest.publisher),
    contentDigest,
    generatedAt
  });
  const signature = sign(
    null,
    Buffer.from(payload),
    keys.privateKey
  ).toString("base64");

  const provenance: PackageProvenance = {
    schemaVersion: "1.0",
    algorithm: "Ed25519",
    packageId: String(manifest.id),
    version: String(manifest.version),
    publisher: String(manifest.publisher),
    signerOrganizationId: organizationId,
    generatedAt,
    publicKeyFingerprint: fingerprint(keys.publicKey),
    publicKey: keys.publicKey,
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
      await readFile(
        join(packageDirectory, ".oeap-provenance.json"),
        "utf8"
      )
    ) as PackageProvenance;
  } catch {
    return undefined;
  }
}

export async function verifyPackageDirectory(
  repoRoot: string,
  packageDirectory: string,
  organizationId = "org_local"
): Promise<{
  valid: boolean;
  reason?: string;
  provenance?: PackageProvenance;
}> {
  const provenance = await readPackageProvenance(packageDirectory);
  if (!provenance) {
    return { valid: false, reason: "Package provenance is missing" };
  }

  const common = await validatePackageContent(
    packageDirectory,
    provenance
  );
  if (!common.valid) return common;

  const keys = signingKeys(repoRoot, organizationId);
  if (fingerprint(keys.publicKey) !== provenance.publicKeyFingerprint) {
    return {
      valid: false,
      reason: "Package was signed by another OEAP publisher key",
      provenance
    };
  }

  return verifySignature(provenance, keys.publicKey);
}

export async function verifyPackageWithEmbeddedKey(
  packageDirectory: string,
  trustedFingerprints: string[]
): Promise<{
  valid: boolean;
  trusted: boolean;
  reason?: string;
  provenance?: PackageProvenance;
}> {
  const provenance = await readPackageProvenance(packageDirectory);
  if (!provenance) {
    return {
      valid: false,
      trusted: false,
      reason: "Package provenance is missing"
    };
  }

  const common = await validatePackageContent(
    packageDirectory,
    provenance
  );
  if (!common.valid) {
    return {
      ...common,
      trusted: false
    };
  }

  if (!provenance.publicKey) {
    return {
      valid: false,
      trusted: false,
      reason: "Portable publisher public key is missing",
      provenance
    };
  }

  const embeddedFingerprint = fingerprint(
    provenance.publicKey
  );
  if (
    embeddedFingerprint !==
    provenance.publicKeyFingerprint
  ) {
    return {
      valid: false,
      trusted: false,
      reason: "Publisher public key fingerprint does not match provenance",
      provenance
    };
  }

  const signatureResult = verifySignature(
    provenance,
    provenance.publicKey
  );
  if (!signatureResult.valid) {
    return {
      ...signatureResult,
      trusted: false
    };
  }

  const normalizedTrust = new Set(
    trustedFingerprints
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  const trusted = normalizedTrust.has(
    embeddedFingerprint.toLowerCase()
  );

  return {
    valid: true,
    trusted,
    reason: trusted
      ? undefined
      : "Package signature is valid but publisher fingerprint is not trusted",
    provenance
  };
}

async function validatePackageContent(
  packageDirectory: string,
  provenance: PackageProvenance
): Promise<{
  valid: boolean;
  reason?: string;
  provenance: PackageProvenance;
}> {
  let manifest: any;
  try {
    manifest = JSON.parse(
      await readFile(
        join(packageDirectory, "oeap.package.json"),
        "utf8"
      )
    );
  } catch {
    return {
      valid: false,
      reason: "Package manifest is missing or invalid",
      provenance
    };
  }

  if (
    String(manifest.id) !== provenance.packageId ||
    String(manifest.version) !== provenance.version ||
    String(manifest.publisher) !== provenance.publisher
  ) {
    return {
      valid: false,
      reason: "Package manifest identity does not match provenance",
      provenance
    };
  }

  const files = await hashPackageFiles(packageDirectory);
  const digest = digestFileList(files);
  if (digest !== provenance.contentDigest) {
    return {
      valid: false,
      reason: "Package content digest does not match provenance",
      provenance
    };
  }

  return {
    valid: true,
    provenance
  };
}

function verifySignature(
  provenance: PackageProvenance,
  publicKey: string
): {
  valid: boolean;
  reason?: string;
  provenance: PackageProvenance;
} {
  const payload = signingPayload({
    packageId: provenance.packageId,
    version: provenance.version,
    publisher: provenance.publisher,
    contentDigest: provenance.contentDigest,
    generatedAt: provenance.generatedAt
  });

  let valid = false;
  try {
    valid = verify(
      null,
      Buffer.from(payload),
      publicKey,
      Buffer.from(provenance.signature, "base64")
    );
  } catch {
    valid = false;
  }

  return {
    valid,
    reason: valid
      ? undefined
      : "Ed25519 signature verification failed",
    provenance
  };
}

async function hashPackageFiles(
  root: string
): Promise<Array<{ path: string; sha256: string; bytes: number }>> {
  const output: Array<{
    path: string;
    sha256: string;
    bytes: number;
  }> = [];

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

function digestFileList(
  files: Array<{ path: string; sha256: string; bytes: number }>
) {
  return createHash("sha256")
    .update(
      files
        .map((item) => `${item.path}\t${item.sha256}\t${item.bytes}`)
        .join("\n")
    )
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

function signingKeys(
  repoRoot: string,
  organizationId: string
): {
  publicKey: string;
  privateKey: string;
} {
  const keyRoot =
    organizationId === "org_local"
      ? runtimePath(repoRoot, "signing")
      : runtimePath(
          repoRoot,
          "signing",
          "organizations",
          safeIdentifier(organizationId)
        );
  const privatePath = join(
    keyRoot,
    "publisher-ed25519-private.pem"
  );
  const publicPath = join(
    keyRoot,
    "publisher-ed25519-public.pem"
  );
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
  return `sha256:${createHash("sha256")
    .update(publicKey)
    .digest("hex")}`;
}

function safeIdentifier(value: unknown): string {
  return String(value).replace(
    /[^A-Za-z0-9_.-]/g,
    "_"
  );
}
