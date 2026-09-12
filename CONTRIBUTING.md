# Contributing to OEAP

Thank you for considering contributing to Open Enterprise AI Platform (OEAP).

OEAP is designed as an open, package-based platform. Contributions are especially welcome in the following areas:

- Core runtime improvements
- Agent / Skill / Workflow packages
- Connectors and MCP integrations
- Data providers
- App templates
- Security and permission controls
- Documentation and examples
- Developer tooling

## Development principles

Please keep these principles in mind:

1. DeepSeek Harness is treated as an external AI runtime. Do not tightly couple OEAP core to one model provider.
2. Business capabilities should be packaged as pluggable components rather than hard-coded into the platform core.
3. Skills should depend on capabilities, not specific vendors.
4. Third-party packages must not bypass permission and data-access layers.
5. External side effects should be auditable.
6. High-risk actions should support explicit approval policies.
7. Public package contracts should have clear schemas and stable interfaces.

## Local development

Requirements:

- Node.js 24+
- pnpm 11.7.0

Install dependencies:

```bash
corepack pnpm install
```

Build all workspace packages:

```bash
corepack pnpm -r build
```

Run the API:

```bash
corepack pnpm --filter @oeap/api dev
```

Run the Web app:

```bash
corepack pnpm --filter @oeap/web dev
```

## Pull requests

Before opening a pull request:

- Keep changes focused.
- Add or update tests for core behavior.
- Avoid unrelated refactors.
- Do not commit secrets, credentials, local databases, or generated runtime state.
- Update documentation when public behavior changes.
- Explain the problem, the implementation, and known trade-offs in the PR description.

## Package contributions

A new package should clearly identify its package type:

- `app`
- `agent`
- `skill`
- `workflow`
- `connector`
- `data-provider`

Where applicable, document:

- Inputs and outputs
- Required capabilities
- Requested permissions
- External dependencies
- Security implications
- Example usage

## Commit style

The project generally uses concise Conventional-Commit-style messages, for example:

```text
feat: add capability registry
fix: normalize generated app database values
docs: expand project README
```

## Discussions and issues

Use GitHub Issues for bugs and actionable feature requests. For broad architecture proposals, start with an issue describing the use case and design constraints before implementing a large change.

By contributing, you agree that your contributions will be licensed under the Apache License 2.0 used by this repository.
