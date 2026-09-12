import {
  rmSync
} from "node:fs";
import {
  resolve
} from "node:path";

import {
  InvitationStore
} from "../apps/api/dist/invitationStore.js";
import {
  TenancyStore
} from "../apps/api/dist/tenancyStore.js";
import {
  AuthSessionStore
} from "../apps/api/dist/authStore.js";

const base = resolve(
  ".tmp",
  "tests",
  `invite-${process.pid}`
);
const tenancyPath = `${base}-tenancy.sqlite`;
const sessionPath = `${base}-sessions.sqlite`;

for (const path of [tenancyPath, sessionPath]) {
  try {
    rmSync(path, { force: true });
  } catch {}
}

const tenancy = new TenancyStore(tenancyPath);
const invitations = new InvitationStore(tenancyPath);
const sessions = new AuthSessionStore(sessionPath);

const memberRole = tenancy
  .listRoles("org_local")
  .find((role) => role.name === "Member");

if (!memberRole) {
  throw new Error("Member role was not bootstrapped");
}

const created = invitations.create({
  organizationId: "org_local",
  email: "invitee@example.com",
  invitedName: "Invitee",
  roleId: memberRole.id,
  appIds: ["app.demo"],
  createdBy: "member_local_owner",
  expiresHours: 24
});

if (!created.token || created.invitation.status !== "pending") {
  throw new Error("Invitation creation failed");
}

const publicInvite = invitations.getPublic(created.token);

if (
  !publicInvite ||
  publicInvite.email !== "invitee@example.com" ||
  publicInvite.roleName !== "Member"
) {
  throw new Error("Public invitation lookup failed");
}

const accepted = invitations.accept({
  token: created.token,
  name: "Accepted Invitee"
});

if (
  accepted.member.name !== "Accepted Invitee" ||
  accepted.member.roleName !== "Member" ||
  !accepted.member.appIds.includes("app.demo") ||
  accepted.invitation.status !== "accepted"
) {
  throw new Error("Invitation acceptance failed");
}

const session = sessions.create({
  provider: "local",
  organizationId: accepted.member.organizationId,
  memberId: accepted.member.id,
  email: accepted.member.email,
  name: accepted.member.name,
  subject: `invitation:${accepted.invitation.id}`,
  ttlHours: 1
});

if (
  !sessions.get(session.token) ||
  sessions.get(session.token)?.memberId !== accepted.member.id
) {
  throw new Error("Invitation session creation failed");
}

let secondAcceptFailed = false;
try {
  invitations.accept({
    token: created.token,
    name: "Duplicate"
  });
} catch {
  secondAcceptFailed = true;
}

if (!secondAcceptFailed) {
  throw new Error("Accepted invitation was reusable");
}

const revoked = invitations.create({
  organizationId: "org_local",
  email: "revoked@example.com",
  roleId: memberRole.id,
  createdBy: "member_local_owner"
});

invitations.revoke(
  revoked.invitation.id,
  "member_local_owner"
);

let revokedAcceptFailed = false;
try {
  invitations.accept({
    token: revoked.token,
    name: "Revoked User"
  });
} catch {
  revokedAcceptFailed = true;
}

if (!revokedAcceptFailed) {
  throw new Error("Revoked invitation was accepted");
}

console.log(
  "✅ ORGANIZATION INVITATION LIFECYCLE TEST PASSED"
);
