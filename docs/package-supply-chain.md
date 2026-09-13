# OEAP Package Supply Chain

OEAP treats executable extensions as a software supply-chain boundary rather than as arbitrary files to copy into the server.

## Package lifecycle

```text
Developer Studio
  → validate manifest/source structure
  → publish to organization-local Marketplace
  → hash package contents
  → sign provenance with Ed25519
  → optionally push to GitHub
  → trusted organization imports package
  → static security scan
  → verify content digest/signature
  → verify publisher fingerprint
  → validate dependencies
  → store in organization Marketplace
  → explicit activation
```

Remote source is never automatically executed as a side effect of import.

## Provenance

A signed Package contains `.oeap-provenance.json` with:

- Package ID, publisher and version
- SHA-256 digest of the signed file list
- Per-file SHA-256 hashes
- Ed25519 signature
- Publisher public key and SHA-256 fingerprint
- Signing organization identifier
- Generation timestamp

The importing organization must explicitly trust the publisher fingerprint. A valid signature by an unknown key is not sufficient for trusted import.

## Static security scan

The importer rejects or flags common unsafe patterns before accepting a remote Package, including:

- Symbolic links
- `.git` and `node_modules` payloads
- Excess file count or file/package size
- Embedded `.env`, private key or credentials-style files
- Operating-system process execution
- Dynamic code evaluation
- Cloud metadata endpoint access
- Suspicious environment access and path traversal
- Sensitive manifest permissions

The scan is intentionally conservative. Passing it does not prove a Package is safe; it creates a minimum admission boundary before human/organizational trust decisions.

## Dependencies

OEAP Package manifests may declare Package dependencies. Import currently checks the target organization’s available official and Marketplace Packages and supports declarative ranges such as exact versions, `^`, `~`, `>=`, `*` and `latest`.

Network, Git, file and workspace dependency URLs are rejected in imported manifests. Package dependencies refer to OEAP Package IDs rather than arbitrary installation scripts.

## Credentials

Packages must not embed credentials. Connector secrets belong in the organization-scoped encrypted credential vault.

GitHub publishing and private Marketplace import use server-side credentials only. Browser clients do not receive the configured token.

## Trust rotation

When a publisher signing key changes, importing organizations must explicitly approve the new fingerprint. This prevents a compromised repository alone from silently establishing a new trusted publisher identity.
