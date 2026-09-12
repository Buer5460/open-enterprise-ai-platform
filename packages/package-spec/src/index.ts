export type OEAPPackageType =
  | "app"
  | "agent"
  | "skill"
  | "workflow"
  | "connector"
  | "data-provider";

export interface OEAPPermission {
  id: string;
  description?: string;
  required?: boolean;
}

export interface OEAPCapabilityRequirement {
  id: string;
  version?: string;
  optional?: boolean;
}

export interface OEAPPackageDependency {
  package: string;
  version: string;
  optional?: boolean;
}

export interface OEAPPackageManifest {
  schemaVersion: "1.0";

  id: string;
  type: OEAPPackageType;

  name: string;
  displayName?: string;
  description?: string;

  version: string;
  publisher: string;

  license?: string;
  homepage?: string;
  repository?: string;

  entrypoint?: string;

  permissions?: OEAPPermission[];

  capabilities?: OEAPCapabilityRequirement[];

  dependencies?: OEAPPackageDependency[];

  tags?: string[];

  metadata?: Record<string, unknown>;
}

export function definePackage(
  manifest: OEAPPackageManifest
): OEAPPackageManifest {
  return manifest;
}
