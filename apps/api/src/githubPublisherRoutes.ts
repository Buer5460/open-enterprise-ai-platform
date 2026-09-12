import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { ConnectorSecretStore } from "./connectorSecretStore.js";
import { listPublishedPackages } from "./platformCatalog.js";
import { TenancyStore } from "./tenancyStore.js";
import { memberFrom, organizationFrom } from "./tenancyRoutes.js";
import { runtimePath } from "./runtimePaths.js";

const PUBLISHER_ID = "oeap.github-publisher";

type PublisherConfig = {
  token: string;
  owner: string;
  repository: string;
  branch: string;
  prefix: string;
};

type RepositoryFile = {
  path: string;
  bytes: Buffer;
};

export function registerGitHubPublisherRoutes(input: {
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
    "/api/developer/github-publisher",
    async (request, reply) => {
      const identity = requireManage(tenancy, request, reply);
      if (!identity) return;

      const config = resolveConfig(vault, identity.organizationId, {});
      return {
        ok: true,
        configured: Boolean(config),
        publisherId: PUBLISHER_ID,
        target: config
          ? {
              owner: config.owner,
              repository: config.repository,
              branch: config.branch,
              prefix: config.prefix
            }
          : undefined,
        requiredCredentialKeys: ["TOKEN", "OWNER", "REPOSITORY"],
        optionalCredentialKeys: ["BRANCH", "PREFIX"]
      };
    }
  );

  input.app.post<{
    Params: { packageId: string };
    Body: {
      owner?: string;
      repository?: string;
      branch?: string;
      prefix?: string;
      commitMessage?: string;
    };
  }>(
    "/api/developer/packages/:packageId/publish/github",
    async (request, reply) => {
      const identity = requireManage(tenancy, request, reply);
      if (!identity) return;

      const packageId = request.params.packageId.trim();
      const published = await listPublishedPackages(input.repoRoot);
      const item = published.find((candidate) => candidate.id === packageId);

      if (!item?.directory) {
        return reply.code(404).send({
          ok: false,
          error: "Package must be published to the local Marketplace before GitHub publishing"
        });
      }

      const config = resolveConfig(
        vault,
        identity.organizationId,
        request.body ?? {}
      );

      if (!config) {
        return reply.code(503).send({
          ok: false,
          error:
            "GitHub Publisher is not configured. Save TOKEN, OWNER and REPOSITORY under connector credential oeap.github-publisher."
        });
      }

      try {
        const localRoot = join(input.repoRoot, item.directory);
        const files = await collectFiles(localRoot);
        if (files.length === 0) {
          throw new Error("Published package directory is empty");
        }

        const packagePrefix = sanitizeRemotePath(
          request.body?.prefix?.trim() ||
            config.prefix ||
            `packages/${item.publisher}/${item.name}`
        );
        const commitBase =
          request.body?.commitMessage?.trim() ||
          `publish: ${item.id}@${item.version}`;

        const pushed: string[] = [];
        for (const file of files) {
          const remotePath = sanitizeRemotePath(
            `${packagePrefix}/${file.path}`
          );
          await putGitHubFile({
            config,
            path: remotePath,
            bytes: file.bytes,
            message: `${commitBase} (${file.path})`
          });
          pushed.push(remotePath);
        }

        return {
          ok: true,
          packageId: item.id,
          version: item.version,
          repository: `${config.owner}/${config.repository}`,
          branch: config.branch,
          prefix: packagePrefix,
          files: pushed,
          repositoryUrl:
            `https://github.com/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}`
        };
      } catch (error) {
        return reply.code(502).send({
          ok: false,
          error: error instanceof Error ? error.message : "GitHub publish failed"
        });
      }
    }
  );
}

function resolveConfig(
  vault: ConnectorSecretStore,
  organizationId: string,
  override: {
    owner?: string;
    repository?: string;
    branch?: string;
    prefix?: string;
  }
): PublisherConfig | undefined {
  const secret = vault.get(organizationId, PUBLISHER_ID);
  const token =
    secret.TOKEN ||
    process.env.OEAP_GITHUB_PUBLISH_TOKEN?.trim() ||
    "";
  const owner =
    override.owner?.trim() ||
    secret.OWNER ||
    process.env.OEAP_GITHUB_PUBLISH_OWNER?.trim() ||
    "";
  const repository =
    override.repository?.trim() ||
    secret.REPOSITORY ||
    process.env.OEAP_GITHUB_PUBLISH_REPOSITORY?.trim() ||
    "";
  const branch =
    override.branch?.trim() ||
    secret.BRANCH ||
    process.env.OEAP_GITHUB_PUBLISH_BRANCH?.trim() ||
    "main";
  const prefix =
    override.prefix?.trim() ||
    secret.PREFIX ||
    process.env.OEAP_GITHUB_PUBLISH_PREFIX?.trim() ||
    "";

  if (!token || !owner || !repository) return undefined;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner)) {
    throw new Error("GitHub publisher owner is invalid");
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("GitHub publisher repository is invalid");
  }
  if (!/^[A-Za-z0-9_./-]+$/.test(branch)) {
    throw new Error("GitHub publisher branch is invalid");
  }

  return { token, owner, repository, branch, prefix };
}

async function collectFiles(root: string): Promise<RepositoryFile[]> {
  const output: RepositoryFile[] = [];

  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (["node_modules", ".git", "dist"].includes(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;

      const info = await stat(absolute);
      if (info.size > 2 * 1024 * 1024) {
        throw new Error(`Publisher refuses files larger than 2 MB: ${entry.name}`);
      }
      const normalized = relative(root, absolute).split(sep).join("/");
      output.push({ path: normalized, bytes: await readFile(absolute) });
    }
  }

  await walk(root);
  const total = output.reduce((sum, file) => sum + file.bytes.length, 0);
  if (total > 10 * 1024 * 1024) {
    throw new Error("Publisher refuses packages larger than 10 MB");
  }
  return output.sort((a, b) => a.path.localeCompare(b.path));
}

async function putGitHubFile(input: {
  config: PublisherConfig;
  path: string;
  bytes: Buffer;
  message: string;
}) {
  const encodedPath = input.path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const endpoint =
    `https://api.github.com/repos/${encodeURIComponent(input.config.owner)}/${encodeURIComponent(input.config.repository)}/contents/${encodedPath}`;
  const headers = {
    Authorization: `Bearer ${input.config.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "OpenEnterpriseAI"
  };

  let sha: string | undefined;
  const existing = await fetch(`${endpoint}?ref=${encodeURIComponent(input.config.branch)}`, {
    headers
  });
  if (existing.ok) {
    const result = await existing.json() as any;
    if (result?.type !== "file" || !result?.sha) {
      throw new Error(`GitHub target is not a file: ${input.path}`);
    }
    sha = String(result.sha);
  } else if (existing.status !== 404) {
    const detail = await githubError(existing);
    throw new Error(`GitHub lookup failed for ${input.path}: ${detail}`);
  }

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: input.message,
      content: input.bytes.toString("base64"),
      branch: input.config.branch,
      ...(sha ? { sha } : {})
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub publish failed for ${input.path}: ${await githubError(response)}`);
  }
}

async function githubError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as any;
  return String(body?.message || `HTTP ${response.status}`);
}

function sanitizeRemotePath(value: string): string {
  const path = value
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[^A-Za-z0-9_.-]/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("/");
  if (!path) throw new Error("GitHub publisher path is invalid");
  return path;
}

function requireManage(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply
): { organizationId: string; memberId: string } | undefined {
  const organizationId = organizationFrom(request);
  const memberId = memberFrom(request);
  try {
    if (!tenancy.authorize({ organizationId, memberId, permission: "packages.manage" })) {
      return forbidden(reply);
    }
  } catch {
    return forbidden(reply);
  }
  return { organizationId, memberId };
}

function forbidden(reply: FastifyReply) {
  reply.code(403).send({ ok: false, error: "Forbidden" });
  return undefined;
}
