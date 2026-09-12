import {
  readdir
} from "node:fs/promises";

import {
  join
} from "node:path";

import {
  appInstaller
} from "../packages/app-installer/dist/index.js";

import {
  packageManager
} from "../packages/package-manager/dist/index.js";

const home = process.env.HOME;

const generatedRoot =
  `${home}/Developer/OpenEnterpriseAI/open-enterprise-ai-platform/.tmp/generated-apps`;

const entries =
  await readdir(
    generatedRoot,
    {
      withFileTypes: true
    }
  );

const appDir =
  entries.find(
    (entry) => entry.isDirectory()
  );

if (!appDir) {
  throw new Error(
    "No generated app package found"
  );
}

const directory =
  join(
    generatedRoot,
    appDir.name
  );

console.log(
  "Installing:",
  directory
);

const installed =
  await appInstaller.installFromDirectory(
    directory
  );

console.log("");
console.log("INSTALLED APP:");
console.log(installed);

if (
  installed.status !== "enabled" ||
  installed.manifest.type !== "app"
) {
  throw new Error(
    "App installation failed"
  );
}

const app =
  packageManager.get(
    installed.manifest.id
  );

if (!app) {
  throw new Error(
    "Installed app not found in Package Manager"
  );
}

console.log("");
console.log(
  "✅ APP INSTALLER TEST PASSED"
);
