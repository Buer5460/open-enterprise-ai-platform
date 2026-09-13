import type {
  OEAPPackageManifest
} from "./index.js";

export const CURRENT_PACKAGE_SCHEMA = "1.0" as const;
export const SUPPORTED_PACKAGE_SCHEMA_MAJOR = 1;

export type PackageCompatibilityIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type PackageCompatibilityResult = {
  compatible: boolean;
  schemaVersion?: string;
  packageVersion?: string;
  issues: PackageCompatibilityIssue[];
};

export function validatePackageCompatibility(
  manifest: unknown
): PackageCompatibilityResult {
  const issues: PackageCompatibilityIssue[] = [];

  if (!manifest || typeof manifest !== "object") {
    return {
      compatible: false,
      issues: [{
        severity: "error",
        code: "manifest.invalid",
        message: "Package manifest must be an object"
      }]
    };
  }

  const value = manifest as Partial<OEAPPackageManifest> &
    Record<string, unknown>;

  const schemaVersion =
    typeof value.schemaVersion === "string"
      ? value.schemaVersion
      : undefined;
  const packageVersion =
    typeof value.version === "string"
      ? value.version
      : undefined;

  if (!schemaVersion) {
    issues.push({
      severity: "error",
      code: "schema.missing",
      message: "schemaVersion is required"
    });
  } else {
    const parsed = parseSchemaVersion(schemaVersion);
    if (!parsed) {
      issues.push({
        severity: "error",
        code: "schema.invalid",
        message: `Invalid schemaVersion: ${schemaVersion}`
      });
    } else if (parsed.major !== SUPPORTED_PACKAGE_SCHEMA_MAJOR) {
      issues.push({
        severity: "error",
        code: "schema.unsupported-major",
        message:
          `Unsupported Package schema major ${parsed.major}; ` +
          `OEAP supports ${SUPPORTED_PACKAGE_SCHEMA_MAJOR}.x`
      });
    } else if (
      compareSchemaVersions(
        schemaVersion,
        CURRENT_PACKAGE_SCHEMA
      ) > 0
    ) {
      issues.push({
        severity: "warning",
        code: "schema.newer-minor",
        message:
          `Package schema ${schemaVersion} is newer than ` +
          `this runtime's ${CURRENT_PACKAGE_SCHEMA}; unknown optional fields are preserved`
      });
    }
  }

  validateRequiredString(value, "id", issues);
  validateRequiredString(value, "name", issues);
  validateRequiredString(value, "publisher", issues);

  if (
    typeof value.type !== "string" ||
    ![
      "app",
      "agent",
      "skill",
      "workflow",
      "connector",
      "data-provider"
    ].includes(value.type)
  ) {
    issues.push({
      severity: "error",
      code: "type.invalid",
      message: "Package type is missing or unsupported"
    });
  }

  if (!packageVersion) {
    issues.push({
      severity: "error",
      code: "version.missing",
      message: "Package version is required"
    });
  } else if (!isSemanticVersion(packageVersion)) {
    issues.push({
      severity: "error",
      code: "version.invalid",
      message: `Package version must be semantic version format: ${packageVersion}`
    });
  }

  if (
    value.dependencies !== undefined &&
    !Array.isArray(value.dependencies)
  ) {
    issues.push({
      severity: "error",
      code: "dependencies.invalid",
      message: "dependencies must be an array"
    });
  }

  return {
    compatible: !issues.some(
      (issue) => issue.severity === "error"
    ),
    schemaVersion,
    packageVersion,
    issues
  };
}

export function assertPackageCompatible(
  manifest: unknown
): asserts manifest is OEAPPackageManifest {
  const result = validatePackageCompatibility(manifest);
  if (!result.compatible) {
    throw new Error(
      result.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join("; ") ||
      "Package manifest is incompatible"
    );
  }
}

export function isPackageUpgradeCompatible(
  fromVersion: string,
  toVersion: string
): boolean {
  const from = parseSemver(fromVersion);
  const to = parseSemver(toVersion);
  if (!from || !to) return false;

  if (to.major !== from.major) {
    return false;
  }

  return compareSemver(to, from) >= 0;
}

function validateRequiredString(
  value: Record<string, unknown>,
  key: string,
  issues: PackageCompatibilityIssue[]
) {
  if (
    typeof value[key] !== "string" ||
    !String(value[key]).trim()
  ) {
    issues.push({
      severity: "error",
      code: `${key}.missing`,
      message: `${key} is required`
    });
  }
}

function parseSchemaVersion(
  value: string
): { major: number; minor: number } | undefined {
  const match = /^(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2])
  };
}

function compareSchemaVersions(
  left: string,
  right: string
): number {
  const a = parseSchemaVersion(left);
  const b = parseSchemaVersion(right);
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major - b.major;
  return a.minor - b.minor;
}

function isSemanticVersion(value: string): boolean {
  return Boolean(parseSemver(value));
}

function parseSemver(
  value: string
): { major: number; minor: number; patch: number } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(
    value.trim()
  );
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compareSemver(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number }
): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}
