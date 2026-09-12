import {
  readdir,
  readFile,
  stat
} from "node:fs/promises";
import {
  join,
  relative,
  sep
} from "node:path";

export type PackageSecurityFinding = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  file?: string;
};

export type PackageSecurityReport = {
  valid: boolean;
  files: number;
  totalBytes: number;
  manifest?: any;
  findings: PackageSecurityFinding[];
};

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs",
  ".json", ".md", ".txt", ".yaml", ".yml",
  ".html", ".css", ".sh"
]);

export async function scanPackageDirectory(
  root: string
): Promise<PackageSecurityReport> {
  const findings: PackageSecurityFinding[] = [];
  let manifest: any;

  try {
    manifest = JSON.parse(
      await readFile(
        join(root, "oeap.package.json"),
        "utf8"
      )
    );
    validateManifest(manifest, findings);
  } catch {
    findings.push({
      severity: "error",
      code: "manifest.invalid",
      message: "oeap.package.json is missing or invalid"
    });
  }

  let files = 0;
  let totalBytes = 0;

  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, {
      withFileTypes: true
    })) {
      const absolute = join(directory, entry.name);
      const rel = relative(root, absolute)
        .split(sep)
        .join("/");

      if (entry.isSymbolicLink()) {
        findings.push({
          severity: "error",
          code: "file.symlink",
          message: "Symbolic links are not allowed in remote packages",
          file: rel
        });
        continue;
      }

      if (entry.isDirectory()) {
        if ([".git", "node_modules"].includes(entry.name)) {
          findings.push({
            severity: "error",
            code: "directory.forbidden",
            message: `${entry.name} must not be included in a package`,
            file: rel
          });
          continue;
        }
        await walk(absolute);
        continue;
      }

      if (!entry.isFile()) continue;
      files += 1;
      if (files > 200) {
        findings.push({
          severity: "error",
          code: "package.file_limit",
          message: "Package contains more than 200 files"
        });
        return;
      }

      const info = await stat(absolute);
      totalBytes += info.size;

      if (info.size > 2 * 1024 * 1024) {
        findings.push({
          severity: "error",
          code: "file.too_large",
          message: "Individual package files may not exceed 2 MB",
          file: rel
        });
      }
      if (totalBytes > 12 * 1024 * 1024) {
        findings.push({
          severity: "error",
          code: "package.too_large",
          message: "Package total size may not exceed 12 MB"
        });
      }

      if (isSecretFile(entry.name)) {
        findings.push({
          severity: "error",
          code: "secret.embedded",
          message: "Credential/private-key style files must not be shipped in a Package",
          file: rel
        });
      }

      const extension = extensionOf(entry.name);
      if (TEXT_EXTENSIONS.has(extension) && info.size <= 512 * 1024) {
        const text = await readFile(absolute, "utf8")
          .catch(() => "");
        scanSource(rel, text, findings);
      }
    }
  }

  try {
    await walk(root);
  } catch (error) {
    findings.push({
      severity: "error",
      code: "package.read_failed",
      message:
        error instanceof Error
          ? error.message
          : "Package could not be scanned"
    });
  }

  return {
    valid: !findings.some(
      (finding) => finding.severity === "error"
    ),
    files,
    totalBytes,
    manifest,
    findings
  };
}

function validateManifest(
  manifest: any,
  findings: PackageSecurityFinding[]
): void {
  if (manifest?.schemaVersion !== "1.0") {
    error(findings, "manifest.schema", "schemaVersion must be 1.0");
  }

  if (!/^[A-Za-z0-9_.-]{3,160}$/.test(String(manifest?.id || ""))) {
    error(findings, "manifest.id", "Package id is invalid");
  }

  if (![
    "app",
    "agent",
    "skill",
    "workflow",
    "connector",
    "data-provider"
  ].includes(String(manifest?.type || ""))) {
    error(findings, "manifest.type", "Package type is unsupported");
  }

  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(manifest?.version || ""))) {
    error(findings, "manifest.version", "Package version must use semantic versioning");
  }

  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(String(manifest?.publisher || ""))) {
    error(findings, "manifest.publisher", "Publisher id is invalid");
  }

  const dependencies = Array.isArray(manifest?.dependencies)
    ? manifest.dependencies
    : [];
  const seen = new Set<string>();

  for (const dependency of dependencies) {
    const packageId = String(dependency?.package || "");
    const version = String(dependency?.version || "");
    if (!/^[A-Za-z0-9_.-]{3,160}$/.test(packageId)) {
      error(findings, "dependency.id", "Dependency package id is invalid");
    }
    if (
      !version ||
      /^(?:https?:|git:|file:|workspace:|\.{1,2}\/)/i.test(version)
    ) {
      error(
        findings,
        "dependency.version",
        `Dependency ${packageId || "unknown"} must use a declarative version range`
      );
    }
    if (seen.has(packageId)) {
      error(findings, "dependency.duplicate", `Duplicate dependency: ${packageId}`);
    }
    seen.add(packageId);
  }

  const permissions = Array.isArray(manifest?.permissions)
    ? manifest.permissions
    : [];
  for (const permission of permissions) {
    const id = String(permission?.id || permission || "");
    if (/shell|process|filesystem\.write|secret|credential|admin|network\.raw/i.test(id)) {
      findings.push({
        severity: "warning",
        code: "permission.sensitive",
        message: `Package requests sensitive permission: ${id}`
      });
    }
  }
}

function scanSource(
  file: string,
  source: string,
  findings: PackageSecurityFinding[]
): void {
  const rules: Array<{
    pattern: RegExp;
    severity: "error" | "warning";
    code: string;
    message: string;
  }> = [
    {
      pattern: /(?:node:)?child_process|\bexecSync\s*\(|\bspawnSync\s*\(/,
      severity: "error",
      code: "source.process_execution",
      message: "Remote Package may not execute operating-system processes"
    },
    {
      pattern: /\beval\s*\(|new\s+Function\s*\(/,
      severity: "error",
      code: "source.dynamic_code",
      message: "Dynamic code evaluation is not allowed"
    },
    {
      pattern: /169\.254\.169\.254|metadata\.google\.internal/i,
      severity: "error",
      code: "source.metadata_access",
      message: "Cloud metadata service access is forbidden"
    },
    {
      pattern: /process\.env|Deno\.env/i,
      severity: "warning",
      code: "source.environment_access",
      message: "Package source reads process environment; prefer Connector credentials"
    },
    {
      pattern: /\.\.\/\.\.\//,
      severity: "warning",
      code: "source.path_traversal",
      message: "Source contains multi-level parent path traversal"
    },
    {
      pattern: /https?:\/\//i,
      severity: "info",
      code: "source.network_literal",
      message: "Package contains literal network endpoints"
    }
  ];

  for (const rule of rules) {
    if (rule.pattern.test(source)) {
      findings.push({
        severity: rule.severity,
        code: rule.code,
        message: rule.message,
        file
      });
    }
  }
}

function isSecretFile(name: string): boolean {
  const value = name.toLowerCase();
  return (
    value === ".env" ||
    value.startsWith(".env.") ||
    value.endsWith(".pem") ||
    value.endsWith(".key") ||
    value.includes("private-key") ||
    value.includes("credentials") ||
    value.includes("secrets")
  );
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0
    ? name.slice(index).toLowerCase()
    : "";
}

function error(
  findings: PackageSecurityFinding[],
  code: string,
  message: string
): void {
  findings.push({
    severity: "error",
    code,
    message
  });
}
