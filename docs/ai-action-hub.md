# AI Action Hub V1

AI Action Hub is OEAP's vendor-neutral action layer. A business capability is defined once as a **Universal Action** and can then be exposed through REST, OpenAPI, MCP and device-assistant adapters without coupling the business implementation to one phone vendor or model provider.

## Architecture

```text
Siri / Gemini / Celia / Xiaomi Agent / YOYO / ChatGPT / Claude / Web
                              |
                        Adapter Layer
                              |
                    Universal Action (UAS)
                              |
                 Risk + Approval + Audit
                              |
                    Connector / Capability
                              |
                   CRM / ERP / Payment / AI
```

The Action Hub does not replace the existing OEAP Agent, Skill, Workflow, Connector or Permission layers. It is the controlled execution gateway that gives those capabilities a stable cross-assistant contract.

## Universal Action Specification

A minimal definition:

```json
{
  "id": "crm.customer.search",
  "version": "1.0.0",
  "displayName": "查询客户",
  "description": "按关键字查询企业 CRM 客户。",
  "capability": "crm.customer.search",
  "permissionAction": "crm.read",
  "risk": "R0",
  "enabled": true,
  "inputSchema": {
    "type": "object",
    "required": ["keyword"],
    "properties": {
      "keyword": { "type": "string" },
      "limit": { "type": "integer" }
    }
  }
}
```

The underlying `capability` must be provided by an installed Connector. The Universal Action is therefore portable while the provider can change independently.

## Risk model

| Risk | Meaning | Execution |
|---|---|---|
| R0 | Read-only/query | Can execute unattended |
| R1 | Low-risk write | Can execute unattended |
| R2 | External/sensitive write | Enterprise approval required |
| R3 | High-risk action such as money movement | Approval plus exact Action ID confirmation |

Action approvals are organization-scoped. Approval payloads are encrypted at rest with AES-256-GCM. Normal execution events intentionally do not copy the business payload into the event log.

## API

### Summary

```http
GET /api/action-hub/summary
```

### Actions

```http
GET /api/action-hub/actions
PUT /api/action-hub/actions/{actionId}
DELETE /api/action-hub/actions/{actionId}
POST /api/action-hub/actions/{actionId}/execute
GET /api/action-hub/actions/{actionId}/adapters?adapter=mcp
```

Example execution:

```json
{
  "input": {
    "prompt": "Summarize today's sales"
  }
}
```

For R2/R3 actions the first call returns HTTP `202` and an `approval_required` result. The Connector is not invoked until an authorized manager approves it.

### Approvals

```http
GET /api/action-hub/approvals
POST /api/action-hub/approvals/{approvalId}/decision
POST /api/action-hub/approvals/{approvalId}/cancel
```

Approve R2:

```json
{
  "decision": "approved"
}
```

Approve R3:

```json
{
  "decision": "approved",
  "confirmation": "money.transfer"
}
```

The confirmation string must exactly match the Action ID.

### Audit

```http
GET /api/action-hub/events
```

## MCP

Endpoint:

```text
/api/action-hub/mcp
```

The endpoint supports the modern MCP `2026-07-28` stateless flow (`server/discover`, `tools/list`, `tools/call`) and accepts the legacy initialize flow for compatibility. Modern HTTP clients should send the protocol routing headers required by the current MCP specification.

An R2/R3 MCP tool call returns a structured `approval_required` result. Execution occurs only after enterprise approval in Action Hub.

## OpenAPI

```text
/api/action-hub/openapi.json
```

The document is generated from all enabled Universal Actions in the current organization.

## Device adapters

The Action Hub currently compiles contracts for:

- MCP
- OpenAPI
- Apple App Intents
- Android AppFunctions
- Huawei Celia / 小艺
- Xiaomi Agent
- HONOR YOYO

Apple and Android outputs include source skeletons. Huawei/Xiaomi/HONOR outputs are remote-action contracts suitable for mapping into the vendor console/SDK.

**Important:** generated adapters do not bypass vendor review, signing, entitlements, developer-account requirements or platform policy. Those are external authorizations and must be completed with the respective vendor.

## Web console

Open **AI Action Hub** from the OEAP sidebar. The console provides:

1. action catalog and test runner;
2. UAS definition editor;
3. R2/R3 approval queue;
4. adapter generator;
5. execution audit history;
6. MCP/OpenAPI endpoint discovery.

`ai.generate` is available as a built-in R0 Universal Action and uses the organization's currently configured OEAP AI Runtime. `email.send` and `money.transfer` are included as disabled templates until matching Connectors are installed and explicitly enabled.

## Production notes

- Keep `OEAP_DATA_DIR` on persistent storage.
- Protect the API with the existing OEAP production identity/session configuration.
- Publish the Action Hub endpoint only behind HTTPS.
- Do not enable an Action until its Connector, permission model and risk classification have been reviewed.
- For R3 capabilities, the external payment/banking system should still enforce its own authentication, risk controls and transaction authorization. Action Hub approval is an additional control, not a replacement for the downstream system's controls.
