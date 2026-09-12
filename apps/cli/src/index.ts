#!/usr/bin/env node
import { OEAPClient } from "@oeap/sdk";

const args = process.argv.slice(2);
const command = args[0] || "help";
const baseUrl = env("OEAP_URL") || "http://127.0.0.1:8787";
const token = env("OEAP_TOKEN");
const client = new OEAPClient({ baseUrl, token });

async function main() {
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    case "status":
      print(await client.health());
      return;
    case "whoami":
      requireToken();
      print(await client.session());
      return;
    case "apps":
      requireToken();
      print(await client.listApps());
      return;
    case "packages":
      requireToken();
      print(await client.listPackages());
      return;
    case "generate": {
      requireToken();
      const description = args.slice(1).join(" ").trim();
      if (!description) fail("Usage: oeap generate <business requirement>");
      print(await client.generateApp({ description }));
      return;
    }
    case "revise": {
      requireToken();
      const appId = args[1];
      const instruction = args.slice(2).join(" ").trim();
      if (!appId || !instruction) fail("Usage: oeap revise <app-id> <instruction>");
      print(await client.reviseApp(appId, instruction));
      return;
    }
    case "approvals": {
      requireToken();
      const status = args[1] as "pending" | "approved" | "rejected" | "cancelled" | undefined;
      print(await client.listApprovals(status));
      return;
    }
    case "ops":
      requireToken();
      print(await client.operationsSummary(Number(args[1] || 30)));
      return;
    default:
      fail(`Unknown command: ${command}\nRun: oeap help`);
  }
}

function printHelp() {
  console.log(`OEAP CLI

Environment:
  OEAP_URL    API base URL (default http://127.0.0.1:8787)
  OEAP_TOKEN  Session token for protected commands

Commands:
  oeap status                         Check API health
  oeap whoami                         Show current OEAP session
  oeap apps                           List accessible enterprise apps
  oeap packages                       List OEAP packages
  oeap generate <requirement>         Generate an enterprise app with AI
  oeap revise <app-id> <instruction>  Modify an existing AI app
  oeap approvals [status]             List approval requests
  oeap ops [days]                     Show operations summary
  oeap help                           Show this help
`);
}

function requireToken() {
  if (!token) {
    fail("OEAP_TOKEN is required for this command.");
  }
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
