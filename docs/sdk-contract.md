# OEAP TypeScript SDK 1.0 Contract

This document defines the public compatibility contract for `@oeap/sdk` as OEAP approaches 1.0.

## Compatibility policy

The public surface listed below is stable for the OEAP 1.x line.

- Patch releases may fix behavior without removing or renaming public methods.
- Minor releases may add methods, optional request fields and optional response fields.
- Existing required request fields will not be added in a minor or patch release.
- Existing response fields will not change meaning in a minor or patch release.
- Removing a method, renaming a method, changing a required parameter, or changing an established return shape requires a new SDK major version.
- `OEAPRequestError` remains the canonical HTTP/API error type for SDK requests.
- Applications should tolerate unknown optional response fields.

## Stable exports

The following exports form the 1.0 public API:

- `OEAPClient`
- `OEAPRequestError`
- `OEAPClientOptions`
- `RequestOptions`
- `OEAPApp`
- `ApprovalStatus`

## Stable `OEAPClient` methods

The following methods are frozen for 1.x:

- `setToken(token?)`
- `health()`
- `session()`
- `listApps()`
- `generateApp(input)`
- `reviseApp(appId, instruction)`
- `listEntityRows(appId, entity, input?)`
- `createEntityRow(appId, entity, data)`
- `updateEntityRow(appId, entity, id, data)`
- `deleteEntityRow(appId, entity, id)`
- `listPackages()`
- `operationsSummary(days?)`
- `listApprovals(status?)`
- `createApproval(input)`
- `decideApproval(approvalId, decision, note?)`
- `listFiles(appId?)`
- `uploadFile(input)`
- `request(path, options?)`

`request()` remains public intentionally so Package authors can call newer OEAP endpoints without waiting for a dedicated SDK wrapper. Dedicated wrappers should be preferred when available.

## Authentication

The SDK sends bearer sessions through `Authorization: Bearer <token>`. Production clients must obtain the token through OEAP's configured authentication flow. Local-development login is not part of the production SDK contract.

## Errors

For non-2xx responses the SDK throws `OEAPRequestError` with:

- `message`
- `status`
- `response`

Callers must not depend on undocumented server error strings. Stable machine-readable error codes may be added in future minor releases.

## Contract regression test

`scripts/test-sdk-contract.mjs` verifies that the frozen 1.0 method surface is not accidentally removed during future refactors. Additions are allowed; removals or renames require an explicit major-version decision.
