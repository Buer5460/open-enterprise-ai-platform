import {
  permissionEngine
} from "../packages/permission-engine/dist/index.js";

import {
  approvalEngine
} from "../packages/approval-engine/dist/index.js";

import {
  connectorRuntime
} from "../packages/connector-runtime/dist/index.js";

import {
  actionGateway
} from "../packages/action-gateway/dist/index.js";

permissionEngine.registerRule({
  id: "growth-social-auto",
  effect: "allow",
  actions: [
    "social.like",
    "social.follow",
    "social.dm"
  ],
  subjects: ["agent:growth"],
  priority: 100
});

permissionEngine.registerRule({
  id: "growth-email-approval",
  effect: "approval",
  actions: ["email.send"],
  subjects: ["agent:growth"],
  priority: 100
});

permissionEngine.registerRule({
  id: "money-deny",
  effect: "deny",
  actions: ["money.*"],
  subjects: ["*"],
  priority: 100
});

connectorRuntime.register({
  executor: {
    id: "mock-connector",
    packageId: "@oeap/mock-connector",
    version: "1.0.0",
    transport: "local",

    async execute(capability, input) {
      return {
        ok: true,
        output: {
          capability,
          input,
          executed: true
        }
      };
    }
  },

  capabilities: [
    { id: "social.like" },
    { id: "email.send" }
  ]
});

const subject = {
  type: "agent",
  id: "growth"
};

const likeResult = await actionGateway.execute({
  requestId: "test-like-001",
  subject,
  action: "social.like",
  capability: "social.like",
  input: {
    leadId: "lead-001"
  }
});

console.log("LIKE:", likeResult.status);

if (likeResult.status !== "executed") {
  throw new Error("social.like should execute automatically");
}

const emailResult = await actionGateway.execute({
  requestId: "test-email-001",
  subject,
  action: "email.send",
  capability: "email.send",
  input: {
    to: "test@example.com"
  }
});

console.log("EMAIL:", emailResult.status);

if (emailResult.status !== "approval_required") {
  throw new Error("email.send should require approval");
}

const moneyResult = await actionGateway.execute({
  requestId: "test-money-001",
  subject,
  action: "money.transfer",
  capability: "money.transfer",
  input: {
    amount: 100
  }
});

console.log("MONEY:", moneyResult.status);

if (moneyResult.status !== "denied") {
  throw new Error("money.transfer should be denied");
}

console.log("");
console.log("✅ ALL ACTION GATEWAY TESTS PASSED");
