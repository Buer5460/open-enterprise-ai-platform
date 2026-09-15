import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  packageManager,
  type InstalledPackage,
  type PackageRuntimeModule
} from "@oeap/package-manager";
import type {
  OEAPPackageDependency,
  OEAPPackageManifest
} from "@oeap/package-spec";

import {
  discoverOfficialPackages
} from "./platformCatalog.js";
import {
  OrganizationPackageStore
} from "./orgPackageStore.js";
import {
  runtimePath
} from "./runtimePaths.js";
import {
  satisfiesSemverRange
} from "./semverRange.js";

export type ActivationStepStatus =
  | "enabled"
  | "already-enabled"
  | "optional-skipped";

export interface ActivationStep {
  packageId: string;
  version?: string;
  status: ActivationStepStatus;
  reason?: string;
}

export interface OfficialPackageActivationResult {
  packageId: string;
  organizationId: string;
  steps: ActivationStep[];
}

export interface OfficialPackageDisableResult {
  packageId: string;
  organizationId: string;
  globallyDisabled: boolean;
}

type CatalogPackage = {
  id: string;
  version: string;
  directory?: string;
};

export interface PackageManagerLike {
  get(packageId: string): InstalledPackage | undefined;
  install(module: PackageRuntimeModule): Promise<InstalledPackage>;
  enable(packageId: string): Promise<InstalledPackage>;
  disable(packageId: string): Promise<InstalledPackage>;
  isEnabled(packageId: string): boolean;
}

export interface OrganizationPackageStoreLike {
  set(
    organizationId: string,
    packageId: string,
    status: "enabled" | "disabled"
  ): void;
  countEnabled(packageId: string): number;
}

export interface OfficialPackageActivatorOptions {
  manager?: PackageManagerLike;
  organizationPackages?: OrganizationPackageStoreLike;
  catalog?: () => Promise<CatalogPackage[]>;
  loadModule?: (
    packageId: string,
    descriptor: CatalogPackage
  ) => Promise<PackageRuntimeModule>;
  satisfies?: (version: string, range: string) => boolean;
}

export class OfficialPackageActivator {
  private readonly manager: PackageManagerLike;
  private readonly organizationPackages:
    OrganizationPackageStoreLike;
  private readonly catalogLoader:
    () => Promise<CatalogPackage[]>;
  private readonly moduleLoader: (
    packageId: string,
    descriptor: CatalogPackage
  ) => Promise<PackageRuntimeModule>;
  private readonly satisfies: (
    version: string,
    range: string
  ) => boolean;

  constructor(
    private readonly repoRoot: string,
    options: OfficialPackageActivatorOptions = {}
  ) {
    this.manager = options.manager ?? packageManager;
    this.organizationPackages =
      options.organizationPackages ??
      new OrganizationPackageStore(
        runtimePath(
          repoRoot,
          "packages",
          "organization-packages.sqlite"
        )
      );
    this.catalogLoader =
      options.catalog ??
      (() => discoverOfficialPackages(repoRoot));
    this.moduleLoader =
      options.loadModule ??
      ((packageId, descriptor) =>
        this.loadRuntimeModule(packageId, descriptor));
    this.satisfies =
      options.satisfies ?? satisfiesSemverRange;
  }

  async hasOfficialPackage(
    packageId: string
  ): Promise<boolean> {
    const catalog = await this.catalogLoader();
    return catalog.some((item) => item.id === packageId);
  }

  async enableForOrganization(
    organizationId: string,
    packageId: string
  ): Promise<OfficialPackageActivationResult> {
    const catalog = await this.catalogLoader();
    const byId = new Map(
      catalog.map((item) => [item.id, item])
    );
    const steps: ActivationStep[] = [];
    const completed = new Set<string>();

    await this.enableRecursive({
      organizationId,
      packageId,
      byId,
      visiting: [],
      completed,
      steps
    });

    return {
      packageId,
      organizationId,
      steps
    };
  }

  async disableForOrganization(
    organizationId: string,
    packageId: string
  ): Promise<OfficialPackageDisableResult> {
    this.organizationPackages.set(
      organizationId,
      packageId,
      "disabled"
    );

    let globallyDisabled = false;

    if (
      this.organizationPackages.countEnabled(packageId) === 0 &&
      this.manager.isEnabled(packageId)
    ) {
      await this.manager.disable(packageId);
      globallyDisabled = true;
    }

    return {
      packageId,
      organizationId,
      globallyDisabled
    };
  }

  private async enableRecursive(input: {
    organizationId: string;
    packageId: string;
    byId: Map<string, CatalogPackage>;
    visiting: string[];
    completed: Set<string>;
    steps: ActivationStep[];
  }): Promise<void> {
    if (input.completed.has(input.packageId)) {
      return;
    }

    const cycleIndex =
      input.visiting.indexOf(input.packageId);
    if (cycleIndex >= 0) {
      const cycle = [
        ...input.visiting.slice(cycleIndex),
        input.packageId
      ];
      throw new Error(
        `Package dependency cycle detected: ${cycle.join(" -> ")}`
      );
    }

    const descriptor = input.byId.get(input.packageId);
    if (!descriptor) {
      throw new Error(
        `Official package not found: ${input.packageId}`
      );
    }

    const installed = this.manager.get(input.packageId);
    const module = installed
      ? undefined
      : await this.moduleLoader(
          input.packageId,
          descriptor
        );
    const manifest =
      installed?.manifest ?? module?.manifest;

    if (!manifest) {
      throw new Error(
        `Package manifest unavailable: ${input.packageId}`
      );
    }

    if (
      descriptor.version &&
      manifest.version !== descriptor.version
    ) {
      throw new Error(
        `Package catalog/runtime version mismatch for ${input.packageId}: catalog ${descriptor.version}, runtime ${manifest.version}`
      );
    }

    const visiting = [
      ...input.visiting,
      input.packageId
    ];

    for (const dependency of manifest.dependencies ?? []) {
      await this.enableDependency({
        organizationId: input.organizationId,
        dependency,
        byId: input.byId,
        visiting,
        completed: input.completed,
        steps: input.steps
      });
    }

    if (!installed && module) {
      await this.manager.install(module);
    }

    const alreadyEnabled =
      this.manager.isEnabled(input.packageId);

    if (!alreadyEnabled) {
      await this.manager.enable(input.packageId);
    }

    this.organizationPackages.set(
      input.organizationId,
      input.packageId,
      "enabled"
    );

    input.steps.push({
      packageId: input.packageId,
      version: manifest.version,
      status:
        alreadyEnabled
          ? "already-enabled"
          : "enabled"
    });
    input.completed.add(input.packageId);
  }

  private async enableDependency(input: {
    organizationId: string;
    dependency: OEAPPackageDependency;
    byId: Map<string, CatalogPackage>;
    visiting: string[];
    completed: Set<string>;
    steps: ActivationStep[];
  }): Promise<void> {
    const descriptor = input.byId.get(
      input.dependency.package
    );

    if (!descriptor) {
      if (input.dependency.optional) {
        input.steps.push({
          packageId: input.dependency.package,
          status: "optional-skipped",
          reason: "Package is not available in the official catalog"
        });
        return;
      }

      throw new Error(
        `Required package dependency not found: ${input.dependency.package}`
      );
    }

    if (
      input.dependency.version &&
      !this.satisfies(
        descriptor.version,
        input.dependency.version
      )
    ) {
      if (input.dependency.optional) {
        input.steps.push({
          packageId: input.dependency.package,
          version: descriptor.version,
          status: "optional-skipped",
          reason:
            `Version ${descriptor.version} does not satisfy ${input.dependency.version}`
        });
        return;
      }

      throw new Error(
        `Package dependency version mismatch: ${input.dependency.package}@${descriptor.version} does not satisfy ${input.dependency.version}`
      );
    }

    await this.enableRecursive({
      organizationId: input.organizationId,
      packageId: input.dependency.package,
      byId: input.byId,
      visiting: input.visiting,
      completed: input.completed,
      steps: input.steps
    });
  }

  private async loadRuntimeModule(
    packageId: string,
    descriptor: CatalogPackage
  ): Promise<PackageRuntimeModule> {
    if (!descriptor.directory) {
      throw new Error(
        `Official package has no runtime directory: ${packageId}`
      );
    }

    const modulePath = join(
      this.repoRoot,
      descriptor.directory,
      "dist",
      "index.js"
    );
    const imported = await import(
      pathToFileURL(modulePath).href
    );
    const runtimeModule = imported.packageModule as
      | PackageRuntimeModule
      | undefined;

    if (!runtimeModule) {
      throw new Error(
        `${packageId} requires connector/runtime configuration and cannot be activated automatically.`
      );
    }

    return runtimeModule;
  }
}

export function packageDependencies(
  manifest: OEAPPackageManifest
): OEAPPackageDependency[] {
  return manifest.dependencies ?? [];
}
