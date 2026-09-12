import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { ConnectorSecretStore } from "./connectorSecretStore.js";
import {
  discoverOfficialPackages,
  listPublishedPackages
} from "./platformCatalog.js";
import {
  verifyPackageWithEmbeddedKey
} from "./packageProvenance.js";
import {
  scanPackageDirectory
} from "./packageSecurity.js";
import { TenancyStore } from "./tenancyStore.js";
import { memberFrom, organizationFrom } from "./tenancyRoutes.js";
import { runtimePath } from "./runtimePaths.js";

const MARKETPLACE_CONNECTOR = "oeap.github-marketplace";

type GitHubItem = {
  type: "file" | "dir" | "symlink" | "submodule";
  path: string;
  name: string;
  size?: number;
  url: string;
  git_url?: string;
  content?: string;
  encoding?: string;
};

export function registerRemotePackageRoutes(input: {
  app: FastifyInstance;
  repoRoot: string;
}) {
  const tenancy = new TenancyStore(
    runtimePath(input.repoRoot, "tenancy", "tenancy.sqlite")
  );
  const vault = new ConnectorSecretStore(
    runtimePath(input.repoRoot, "settings", "connector-secrets.enc"),
    runtimePath(input.repoRoot, "settings", "connector-secrets.key")
  );

  input.app.get(
    "/api/marketplace/import/github/status",
    async (request, reply) => {
      const identity = requireManage(tenancy, request, reply);
      if (!identity) return;

      const secret = vault.get(
        identity.organizationId,
        MARKETPLACE_CONNECTOR
      );
      const trusted = trustedFingerprints(secret, undefined);

      return {
        ok: true,
        connectorId: MARKETPLACE_CONNECTOR,
        hasToken: Boolean(secret.TOKEN),
        trustedFingerprints: trusted,
        requiredForPrivateRepositories: ["TOKEN"],
        recommendedKeys: ["TOKEN", "TRUSTED_FINGERPRINTS"]
      };
    }
  );

  input.app.post<{
    Body: {
      owner?: string;
      repository?: string;
      branch?: string;
      prefix?: string;
      expectedFingerprint?: string;
    };
  }>(
    "/api/marketplace/import/github",
    async (request, reply) => {
      const identity = requireManage(tenancy, request, reply);
      if (!identity) return;

      const owner = request.body?.owner?.trim() || "";
      const repository = request.body?.repository?.trim() || "";
      const branch = request.body?.branch?.trim() || "main";
      const prefix = normalizePrefix(
        request.body?.prefix?.trim() || ""
      );

      if (!/^[A-Za-z0-9_.-]+$/.test(owner)) {
        return badRequest(reply, "GitHub owner is invalid");
      }
      if (!/^[A-Za-z0-9_.-]+$/.test(repository)) {
        return badRequest(reply, "GitHub repository is invalid");
      }
      if (!/^[A-Za-z0-9_./-]+$/.test(branch)) {
        return badRequest(reply, "GitHub branch is invalid");
      }

      const secret = vault.get(
        identity.organizationId,
        MARKETPLACE_CONNECTOR
      );
      const trusted = trustedFingerprints(
        secret,
        request.body?.expectedFingerprint
      );

      if (trusted.length === 0) {
        return reply.code(400).send({
          ok: false,
          error:
            "A trusted publisher fingerprint is required before importing remote Packages. Save TRUSTED_FINGERPRINTS in oeap.github-marketplace or provide expectedFingerprint."
        });
      }

      const importId = `import_${randomUUID()}`;
      const staging = runtimePath(
        input.repoRoot,
        "imports",
        safeIdentifier(identity.organizationId),
        importId
      );

      try {
        await mkdir(staging, { recursive: true });
        const downloaded = await downloadGitHubDirectory({
          owner,
          repository,
          branch,
          prefix,
          token: secret.TOKEN,
          target: staging
        });

        const scan = await scanPackageDirectory(staging);
        if (!scan.valid) {
          return reply.code(400).send({
            ok: false,
            stage: "security-scan",
            error: "Remote Package failed static security scanning",
            scan
          });
        }

        const provenance = await verifyPackageWithEmbeddedKey(
          staging,
          trusted
        );
        if (!provenance.valid || !provenance.trusted) {
          return reply.code(400).send({
            ok: false,
            stage: "provenance",
            error:
              provenance.reason ||
              "Remote Package provenance is not trusted",
            provenance
          });
        }

        const manifest = scan.manifest;
        const dependencies = await validateDependencies(
          input.repoRoot,
          identity.organizationId,
          manifest?.dependencies
        );
        if (!dependencies.valid) {
          return reply.code(409).send({
            ok: false,
            stage: "dependencies",
            error: "Package dependencies are not satisfied",
            dependencies
          });
        }

        const directoryName = safePackageName(
          String(manifest.name || manifest.id)
        );
        const target = marketplacePackageRoot(
          input.repoRoot,
          identity.organizationId,
          directoryName
        );

        await rm(target, {
          recursive: true,
          force: true
        });
        await mkdir(target, {
          recursive: true
        });
        await cp(staging, target, {
          recursive: true
        });
        await writeFile(
          join(target, "publication.json"),
          JSON.stringify(
            {
              packageId: manifest.id,
              organizationId: identity.organizationId,
              importedAt: new Date().toISOString(),
              channel: "github-marketplace",
              source: {
                owner,
                repository,
                branch,
                prefix
              },
              trustedFingerprint:
                provenance.provenance?.publicKeyFingerprint,
              downloadedFiles: downloaded.files,
              downloadedBytes: downloaded.bytes,
              securityWarnings: scan.findings.filter(
                (finding) => finding.severity !== "error"
              )
            },
            null,
            2
          ),
          "utf8"
        );

        return {
          ok: true,
          package: {
            id: manifest.id,
            name: manifest.name,
            displayName:
              manifest.displayName || manifest.name,
            type: manifest.type,
            version: manifest.version,
            publisher: manifest.publisher,
            status: "available",
            source: "remote"
          },
          provenance,
          scan,
          dependencies,
          note:
            "Remote Package has been imported into the organization Marketplace. Remote source code is not auto-executed; runtime activation remains explicit."
        };
      } catch (error) {
        return reply.code(502).send({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Remote Package import failed"
        });
      } finally {
        await rm(staging, {
          recursive: true,
          force: true
        }).catch(() => undefined);
      }
    }
  );
}

async function downloadGitHubDirectory(input: {
  owner: string;
  repository: string;
  branch: string;
  prefix: string;
  token?: string;
  target: string;
}): Promise<{ files: number; bytes: number }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "OpenEnterpriseAI"
  };
  if (input.token) {
    headers.Authorization = `Bearer ${input.token}`;
  }

  const rootPath = input.prefix
    ? `/${encodeGitHubPath(input.prefix)}`
    : "";
  const first =
    `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/contents${rootPath}?ref=${encodeURIComponent(input.branch)}`;

  const queue = [first];
  let files = 0;
  let bytes = 0;

  while (queue.length > 0) {
    const url = queue.shift()!;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(
        `GitHub Marketplace fetch failed: ${await githubError(response)}`
      );
    }

    const payload = await response.json() as GitHubItem | GitHubItem[];
    const items = Array.isArray(payload) ? payload : [payload];

    for (const item of items) {
      if (item.type === "dir") {
        queue.push(
          `${item.url}${item.url.includes("?") ? "&" : "?"}ref=${encodeURIComponent(input.branch)}`
        );
        continue;
      }
      if (item.type !== "file") {
        throw new Error(
          `Unsupported GitHub repository entry type: ${item.type} (${item.path})`
        );
      }

      files += 1;
      if (files > 200) {
        throw new Error("Remote Package exceeds 200-file import limit");
      }
      if (Number(item.size || 0) > 2 * 1024 * 1024) {
        throw new Error(`Remote Package file exceeds 2 MB: ${item.path}`);
      }

      const relative = relativeToPrefix(
        item.path,
        input.prefix
      );
      const safeRelative = safeRemoteRelative(relative);
      const content = await fetchGitHubFile(
        item,
        input.branch,
        headers
      );
      bytes += content.length;
      if (bytes > 12 * 1024 * 1024) {
        throw new Error("Remote Package exceeds 12 MB import limit");
      }

      const destination = join(
        input.target,
        ...safeRelative.split("/")
      );
      await mkdir(dirname(destination), {
        recursive: true
      });
      await writeFile(destination, content);
    }
  }

  if (files === 0) {
    throw new Error("GitHub Package directory is empty");
  }

  return { files, bytes };
}

async function fetchGitHubFile(
  item: GitHubItem,
  branch: string,
  headers: Record<string, string>
): Promise<Buffer> {
  let payload = item;

  if (!payload.content) {
    const response = await fetch(
      `${item.url}${item.url.includes("?") ? "&" : "?"}ref=${encodeURIComponent(branch)}`,
      { headers }
    );
    if (!response.ok) {
      throw new Error(
        `GitHub file fetch failed for ${item.path}: ${await githubError(response)}`
      );
    }
    payload = await response.json() as GitHubItem;
  }

  if (!payload.content || payload.encoding !== "base64") {
    throw new Error(
      `GitHub file content is unavailable or too large: ${item.path}`
    );
  }

  return Buffer.from(
    payload.content.replace(/\n/g, ""),
    "base64"
  );
}

async function validateDependencies(
  repoRoot: string,
  organizationId: string,
  dependencies: unknown
) {
  const declared = Array.isArray(dependencies)
    ? dependencies
    : [];
  const [official, organizationPackages] = await Promise.all([
    discoverOfficialPackages(repoRoot),
    listPublishedPackages(repoRoot, organizationId)
  ]);
  const available = new Map(
    [...official, ...organizationPackages].map((item) => [
      item.id,
      item.version
    ])
  );

  const results = declared.map((dependency: any) => {
    const packageId = String(dependency?.package || "");
    const range = String(dependency?.version || "");
    const optional = Boolean(dependency?.optional);
    const installedVersion = available.get(packageId);
    const satisfied = Boolean(
      installedVersion &&
      satisfiesVersion(installedVersion, range)
    );

    return {
      packageId,
      range,
      optional,
      installedVersion,
      satisfied:
        satisfied || optional
    };
  });

  return {
    valid: results.every((item) => item.satisfied),
    dependencies: results
  };
}

function satisfiesVersion(
  version: string,
  range: string
): boolean {
  if (!range || range === "*" || range === "latest") return true;
  if (/^\d+\.\d+\.\d+$/.test(range)) return version === range;

  const current = parseVersion(version);
  const expected = parseVersion(
    range.replace(/^[~^>=< ]+/, "")
  );
  if (!current || !expected) return false;

  if (range.startsWith("^")) {
    return current[0] === expected[0] && compareVersion(current, expected) >= 0;
  }
  if (range.startsWith("~")) {
    return current[0] === expected[0] &&
      current[1] === expected[1] &&
      compareVersion(current, expected) >= 0;
  }
  if (range.startsWith(">=")) {
    return compareVersion(current, expected) >= 0;
  }

  return false;
}

function parseVersion(value: string): [number, number, number] | undefined {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : undefined;
}

function compareVersion(
  left: [number, number, number],
  right: [number, number, number]
): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function marketplacePackageRoot(
  repoRoot: string,
  organizationId: string,
  directoryName: string
): string {
  return organizationId === "org_local"
    ? runtimePath(
        repoRoot,
        "marketplace-packages",
        directoryName
      )
    : runtimePath(
        repoRoot,
        "organizations",
        safeIdentifier(organizationId),
        "marketplace-packages",
        directoryName
      );
}

function trustedFingerprints(
  secret: Record<string, string>,
  requested?: string
): string[] {
  return [
    requested || "",
    secret.TRUSTED_FINGERPRINTS || "",
    process.env.OEAP_MARKETPLACE_TRUSTED_FINGERPRINTS || ""
  ]
    .join(",")
    .split(/[,\n\s]+/)
    .map((value) => value.trim())
    .filter((value) => /^sha256:[a-f0-9]{64}$/i.test(value));
}

function normalizePrefix(value: string): string {
  if (!value) return "";
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) =>
      part.replace(/[^A-Za-z0-9_.-]/g, "-")
    )
    .filter(Boolean)
    .join("/");
}

function safeRemoteRelative(value: string): string {
  const normalized = normalizePrefix(value);
  if (!normalized) {
    throw new Error("Remote Package contains an invalid file path");
  }
  return normalized;
}

function relativeToPrefix(
  path: string,
  prefix: string
): string {
  if (!prefix) return path;
  if (path === prefix) return path.split("/").at(-1) || path;
  return path.startsWith(`${prefix}/`)
    ? path.slice(prefix.length + 1)
    : path;
}

function encodeGitHubPath(value: string): string {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function safePackageName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "package";
}

function safeIdentifier(value: unknown): string {
  return String(value).replace(
    /[^A-Za-z0-9_.-]/g,
    "_"
  );
}

async function githubError(
  response: Response
): Promise<string> {
  const body = await response.json().catch(() => ({})) as any;
  return String(body?.message || `HTTP ${response.status}`);
}

function requireManage(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply
): { organizationId: string; memberId: string } | undefined {
  const organizationId = organizationFrom(request);
  const memberId = memberFrom(request);
  try {
    if (!tenancy.authorize({
      organizationId,
      memberId,
      permission: "packages.manage"
    })) {
      return forbidden(reply);
    }
  } catch {
    return forbidden(reply);
  }
  return { organizationId, memberId };
}

function badRequest(
  reply: FastifyReply,
  error: string
) {
  return reply.code(400).send({
    ok: false,
    error
  });
}

function forbidden(reply: FastifyReply) {
  reply.code(403).send({
    ok: false,
    error: "Forbidden"
  });
  return undefined;
}
