import type {
  OEAPPackageManifest
} from "@oeap/package-spec";

import {
  eventBus
} from "@oeap/event-bus";

export type PackageStatus =
  | "installed"
  | "enabled"
  | "disabled";

export interface PackageRuntimeModule {
  manifest: OEAPPackageManifest;

  activate?: () =>
    void | Promise<void>;

  deactivate?: () =>
    void | Promise<void>;
}

export interface InstalledPackage {
  manifest: OEAPPackageManifest;

  status: PackageStatus;

  installedAt: string;

  updatedAt: string;
}

export class PackageManager {
  private readonly packages =
    new Map<string, InstalledPackage>();

  private readonly modules =
    new Map<string, PackageRuntimeModule>();

  async install(
    module: PackageRuntimeModule
  ): Promise<InstalledPackage> {
    const { manifest } = module;

    if (this.packages.has(manifest.id)) {
      throw new Error(
        `Package already installed: ${manifest.id}`
      );
    }

    const now = new Date().toISOString();

    const installed: InstalledPackage = {
      manifest,
      status: "installed",
      installedAt: now,
      updatedAt: now
    };

    this.packages.set(
      manifest.id,
      installed
    );

    this.modules.set(
      manifest.id,
      module
    );

    await eventBus.publish({
      id: `package-installed:${manifest.id}:${Date.now()}`,
      type: "package.installed",
      source: {
        type: "system",
        id: "package-manager"
      },
      payload: {
        packageId: manifest.id,
        type: manifest.type,
        version: manifest.version
      }
    });

    return installed;
  }

  async enable(
    packageId: string
  ): Promise<InstalledPackage> {
    const installed =
      this.requirePackage(packageId);

    const module =
      this.modules.get(packageId);

    if (module?.activate) {
      await module.activate();
    }

    const updated: InstalledPackage = {
      ...installed,
      status: "enabled",
      updatedAt: new Date().toISOString()
    };

    this.packages.set(
      packageId,
      updated
    );

    await eventBus.publish({
      id: `package-enabled:${packageId}:${Date.now()}`,
      type: "package.enabled",
      source: {
        type: "system",
        id: "package-manager"
      },
      payload: {
        packageId
      }
    });

    return updated;
  }

  async disable(
    packageId: string
  ): Promise<InstalledPackage> {
    const installed =
      this.requirePackage(packageId);

    const module =
      this.modules.get(packageId);

    if (module?.deactivate) {
      await module.deactivate();
    }

    const updated: InstalledPackage = {
      ...installed,
      status: "disabled",
      updatedAt: new Date().toISOString()
    };

    this.packages.set(
      packageId,
      updated
    );

    await eventBus.publish({
      id: `package-disabled:${packageId}:${Date.now()}`,
      type: "package.disabled",
      source: {
        type: "system",
        id: "package-manager"
      },
      payload: {
        packageId
      }
    });

    return updated;
  }

  async uninstall(
    packageId: string
  ): Promise<void> {
    const installed =
      this.requirePackage(packageId);

    if (installed.status === "enabled") {
      await this.disable(packageId);
    }

    this.packages.delete(packageId);
    this.modules.delete(packageId);

    await eventBus.publish({
      id: `package-uninstalled:${packageId}:${Date.now()}`,
      type: "package.uninstalled",
      source: {
        type: "system",
        id: "package-manager"
      },
      payload: {
        packageId
      }
    });
  }

  get(
    packageId: string
  ): InstalledPackage | undefined {
    return this.packages.get(packageId);
  }

  list(
    type?: OEAPPackageManifest["type"]
  ): InstalledPackage[] {
    const packages = [
      ...this.packages.values()
    ];

    if (!type) {
      return packages;
    }

    return packages.filter(
      (item) =>
        item.manifest.type === type
    );
  }

  isEnabled(
    packageId: string
  ): boolean {
    return (
      this.packages.get(packageId)
        ?.status === "enabled"
    );
  }

  private requirePackage(
    packageId: string
  ): InstalledPackage {
    const installed =
      this.packages.get(packageId);

    if (!installed) {
      throw new Error(
        `Package not installed: ${packageId}`
      );
    }

    return installed;
  }
}

export const packageManager =
  new PackageManager();
