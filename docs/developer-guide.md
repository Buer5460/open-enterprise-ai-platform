# OEAP Developer Guide

OEAP extensions use one Package model across AI-generated applications, source-code development and the future visual builders.

## Package types

- `app` — complete enterprise application
- `agent` — goal-oriented AI role
- `skill` — reusable business capability or SOP
- `workflow` — multi-step process that composes Agents and Skills
- `connector` — MCP, SaaS, HTTP API or local-system adapter
- `data-provider` — enterprise/professional data source

## Developer Studio workflow

1. Open **Developer Studio**.
2. Choose a Package type and define its name, publisher and business purpose.
3. OEAP generates:
   - `oeap.package.json`
   - `package.json`
   - `src/index.ts`
   - `tests/smoke.mjs`
   - `README.md`
4. Edit the generated source.
5. Run Package validation.
6. Publish to the current organization’s local Marketplace.
7. In **发布与来源**, generate and verify provenance.
8. Optionally publish to GitHub through the server-side GitHub Publisher.

## TypeScript SDK

The `@oeap/sdk` package provides a typed HTTP client for OEAP platform APIs. Authentication uses the same Bearer Session token used by the web workspace.

The SDK is intended for:

- internal automation
- enterprise integrations
- developer tooling
- CI/CD administration
- future external control planes

## CLI

The `@oeap/cli` workspace package is a command-line client built on the SDK. It is suitable for local development and CI workflows without embedding platform credentials in source code.

## Runtime rules

Packages should be declarative first:

- Declare permissions and dependencies in the manifest.
- Use Skills for reusable business behavior.
- Use Connectors for external side effects.
- Use the Action Gateway when a side effect requires permission/approval/audit.
- Use the encrypted Connector credential vault for secrets.
- Do not read arbitrary host secrets or filesystem paths.
- Do not put API keys, OAuth secrets or private keys in Package source.

## Enterprise knowledge

App generation/revision automatically receives relevant enterprise knowledge when available. Agent execution contexts also support automatic knowledge enrichment when a workspace/organization ID and meaningful task/query input are present.

Packages should consume provided context instead of opening the knowledge database directly.

## Distribution and trust

Before a Package crosses an organization boundary, OEAP supports:

- deterministic SHA-256 content digest
- Ed25519 signature
- publisher public-key fingerprint
- static security scan
- dependency validation
- explicit trusted-publisher fingerprint policy

See [package-supply-chain.md](package-supply-chain.md).

## Local build

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm test
```

For the full platform:

```bash
./scripts/start-local.sh
```

## Compatibility

OEAP 0.9.x is a Production Candidate. Package Manifest 1.x and public SDK compatibility guarantees will be frozen for OEAP 1.0. Until then, extension authors should pin the platform minor version they validate against.
