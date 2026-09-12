# Open Enterprise AI Platform - Agent Rules

## Core principles

1. DeepSeek Harness is an external runtime. Do not modify DeepSeek Harness source code from this repository.
2. Business capabilities must be implemented as pluggable packages.
3. Do not hard-code software development, marketing, investment, travel, payment or other industries into platform core.
4. Agent, Skill, Workflow, Connector and App must be independently installable and replaceable.
5. Skills depend on capabilities, not specific vendors.
6. Third-party packages must never access the database directly.
7. All data access must pass through Data Access + Permission layers.
8. External side effects must be auditable.
9. High-risk actions require approval policies.
10. Every public package must have explicit input/output schemas and permissions.

## Package types

- app
- agent
- skill
- workflow
- connector
- data-provider

## Development rules

- TypeScript first.
- Schema first.
- API contracts before implementation.
- Tests required for core behavior.
- No secrets in source code.
- Database changes require migrations.
- Avoid unnecessary dependencies.
- Do not delete or refactor unrelated functionality.
- Before changing code, inspect existing implementation.
- After every task report:
  - changed files
  - purpose
  - tests
  - known risks
