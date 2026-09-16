import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ActionHubStore
} from "../apps/api/dist/actionHubStore.js";

const root = mkdtempSync(
  join(tmpdir(), "oeap-action-hub-")
);

try {
  const dataPath = join(root, "action-hub.enc.json");
  const keyPath = join(root, "action-hub.key");
  const store = new ActionHubStore(
    dataPath,
    keyPath
  );

  const defaults = store.listActions("org_test");
  assert.ok(
    defaults.some((item) => item.id === "ai.generate")
  );
  assert.ok(
    defaults.some((item) => item.id === "email.send")
  );

  const action = store.upsertAction(
    "org_test",
    {
      id: "test.external.write",
      version: "1.0.0",
      displayName: "External write",
      description: "Test R2 action",
      capability: "test.external.write",
      permissionAction: "test.write",
      risk: "R2",
      enabled: true,
      inputSchema: {
        type: "object",
        required: ["secret"],
        properties: {
          secret: { type: "string" }
        }
      }
    }
  );

  assert.equal(action.risk, "R2");

  const approval = store.createApproval({
    organizationId: "org_test",
    memberId: "member_test",
    action,
    payload: {
      secret: "SENSITIVE_ACTION_PAYLOAD"
    }
  });

  assert.equal(approval.status, "pending");
  assert.equal(
    store.listApprovals({
      organizationId: "org_test",
      status: "pending"
    }).length,
    1
  );

  const approved = store.decideApproval({
    organizationId: "org_test",
    approvalId: approval.id,
    decidedBy: "manager_test",
    decision: "approved"
  });
  assert.equal(approved.status, "approved");

  const executed = store.markApprovalExecution({
    organizationId: "org_test",
    approvalId: approval.id,
    status: "executed"
  });
  assert.equal(executed.status, "executed");

  store.recordEvent({
    organizationId: "org_test",
    memberId: "member_test",
    actionId: action.id,
    status: "success",
    durationMs: 12,
    approvalId: approval.id
  });

  assert.equal(
    store.listEvents({
      organizationId: "org_test"
    })[0]?.status,
    "success"
  );

  const encrypted = readFileSync(dataPath, "utf8");
  assert.equal(
    encrypted.includes("SENSITIVE_ACTION_PAYLOAD"),
    false,
    "approval payload must not be stored in plaintext"
  );

  console.log("✅ Action Hub encrypted store tests passed");
} finally {
  rmSync(root, {
    recursive: true,
    force: true
  });
}
