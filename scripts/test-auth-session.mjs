import {
  mkdtempSync,
  rmSync
} from "node:fs";

import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AuthSessionStore,
  bearerToken
} from "../apps/api/dist/authStore.js";

const root = mkdtempSync(
  join(tmpdir(), "oeap-auth-")
);

try {
  const store = new AuthSessionStore(
    join(root, "sessions.sqlite")
  );

  const created = store.create({
    provider: "local",
    organizationId: "org_test",
    memberId: "member_test",
    name: "Test User",
    email: "test@example.com",
    ttlHours: 1
  });

  if (!created.token.startsWith("oeap_")) {
    throw new Error("Unexpected session token format");
  }

  const token = bearerToken(
    `Bearer ${created.token}`
  );

  if (token !== created.token) {
    throw new Error("Bearer token parsing failed");
  }

  const loaded = store.get(created.token);

  if (
    !loaded ||
    loaded.organizationId !== "org_test" ||
    loaded.memberId !== "member_test" ||
    loaded.provider !== "local"
  ) {
    throw new Error("Session persistence failed");
  }

  store.revoke(created.token);

  if (store.get(created.token)) {
    throw new Error("Session revoke failed");
  }

  console.log(
    "✅ AUTH SESSION LIFECYCLE TEST PASSED"
  );
} finally {
  rmSync(root, {
    recursive: true,
    force: true
  });
}
