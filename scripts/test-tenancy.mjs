import {
  TenancyStore
} from "../apps/api/dist/tenancyStore.js";

import {
  mkdtempSync,
  rmSync
} from "node:fs";

import {
  join
} from "node:path";

import {
  tmpdir
} from "node:os";

const root = mkdtempSync(
  join(tmpdir(), "oeap-tenancy-")
);

try {
  const store = new TenancyStore(
    join(root, "tenancy.sqlite")
  );

  const local = store.getContext("org_local");

  if (
    local.members.length !== 1 ||
    local.roles.length < 5
  ) {
    throw new Error(
      "Local organization bootstrap failed"
    );
  }

  const viewer = local.roles.find(
    (role) => role.name === "Viewer"
  );

  if (!viewer) {
    throw new Error("Viewer role missing");
  }

  const member = store.createMember({
    organizationId: "org_local",
    name: "CI Viewer",
    email: "viewer@example.test",
    roleId: viewer.id,
    appIds: ["app.demo"],
    actorMemberId: "member_local_owner"
  });

  if (
    !store.authorize({
      organizationId: "org_local",
      memberId: member.id,
      permission: "apps.read",
      appId: "app.demo"
    })
  ) {
    throw new Error(
      "Viewer should be able to read assigned app"
    );
  }

  if (
    store.authorize({
      organizationId: "org_local",
      memberId: member.id,
      permission: "data.write",
      appId: "app.demo"
    })
  ) {
    throw new Error(
      "Viewer unexpectedly received write permission"
    );
  }

  store.setMemberAppAccess(
    member.id,
    ["app.other"],
    "member_local_owner"
  );

  if (
    store.authorize({
      organizationId: "org_local",
      memberId: member.id,
      permission: "apps.read",
      appId: "app.demo"
    })
  ) {
    throw new Error(
      "App access restriction was not enforced"
    );
  }

  store.updateMember(member.id, {
    status: "disabled",
    actorMemberId: "member_local_owner"
  });

  if (
    store.authorize({
      organizationId: "org_local",
      memberId: member.id,
      permission: "apps.read",
      appId: "app.other"
    })
  ) {
    throw new Error(
      "Disabled member should not be authorized"
    );
  }

  const customRole = store.createRole({
    organizationId: "org_local",
    name: "Sales Auditor",
    permissions: [
      "apps.read",
      "data.read"
    ],
    actorMemberId: "member_local_owner"
  });

  if (
    customRole.permissions.length !== 2
  ) {
    throw new Error(
      "Custom role permissions were not persisted"
    );
  }

  if (store.listAudit("org_local").length < 4) {
    throw new Error(
      "Tenancy audit trail was not recorded"
    );
  }

  console.log(
    "✅ TENANCY AND RBAC LIFECYCLE TEST PASSED"
  );
} finally {
  rmSync(root, {
    recursive: true,
    force: true
  });
}
