# Security Policy

OEAP is currently experimental and under active development. Security-sensitive behavior may change before the first stable release.

## Reporting a vulnerability

Please do not publish exploitable security vulnerabilities in a public issue.

For now, contact the repository owner privately through GitHub. A dedicated security contact and disclosure workflow will be added as the project matures.

When reporting a vulnerability, include:

- Affected package or component
- Reproduction steps
- Expected and actual behavior
- Potential impact
- Suggested mitigation, if known

## Security model

OEAP is designed around several security boundaries:

- Permission Engine controls whether an action is allowed, denied, or requires approval.
- Approval Engine represents explicit human authorization for sensitive actions.
- Action Gateway routes side-effecting actions through permission, approval, execution, and audit layers.
- Audit Log records execution outcomes.
- Capability Registry separates business capabilities from concrete service providers.
- Third-party packages should access external systems through declared Connectors rather than bypass platform controls.

## Current limitations

The current codebase is not yet production-hardened. In particular, deployments should assume the following are incomplete or evolving:

- Authentication and SSO
- Fine-grained multi-tenant authorization
- Persistent enterprise-grade audit storage
- Secret management and key rotation
- Package signing and trust verification
- Sandbox isolation for untrusted third-party code
- Rate limiting and abuse controls
- Data encryption policies
- Marketplace review and malware scanning
- Production database migrations and high availability

## High-risk actions

Do not use the current experimental implementation for unattended:

- Money transfers
- Live securities or crypto trading
- Irreversible data deletion
- Production infrastructure deployment
- Bulk external messaging
- Other regulated or safety-critical actions

These actions should require stronger policy, approval, credential, audit, and environment isolation controls.

## Secrets

Never commit:

- API keys
- OAuth tokens
- Passwords
- Private keys
- Local `.env` files
- DeepSeek Harness credentials or `DSH_HOME` state
- Local SQLite databases containing real business data

If a secret is accidentally committed, revoke or rotate it immediately. Removing it from the latest Git commit alone is not sufficient because it may remain in Git history.
