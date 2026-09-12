import {
  readFile
} from "node:fs/promises";

import {
  join
} from "node:path";

import type {
  OEAPAppManifest
} from "@oeap/package-spec";

import {
  packageManager,
  type InstalledPackage
} from "@oeap/package-manager";

export class AppInstaller {
  async installFromDirectory(
    directory: string
  ): Promise<InstalledPackage> {
    const manifestPath =
      join(directory, "oeap.package.json");

    const raw =
      await readFile(
        manifestPath,
        "utf8"
      );

    const manifest =
      JSON.parse(raw) as OEAPAppManifest;

    if (manifest.type !== "app") {
      throw new Error(
        `Package is not an app: ${manifest.type}`
      );
    }

    if (
      !manifest.id ||
      !manifest.version ||
      !manifest.publisher
    ) {
      throw new Error(
        "Invalid OEAP App manifest"
      );
    }

    await packageManager.install({
      manifest
    });

    return packageManager.enable(
      manifest.id
    );
  }

  async uninstall(
    appId: string
  ): Promise<void> {
    await packageManager.uninstall(
      appId
    );
  }
}

export const appInstaller =
  new AppInstaller();
