import {
  mkdtemp,
  rm
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createDeveloperPackage,
  listDeveloperPackages,
  listPublishedPackages,
  publishDeveloperPackage
} from "../apps/api/dist/platformCatalog.js";
import {
  OrganizationPackageStore
} from "../apps/api/dist/orgPackageStore.js";
import {
  TenancyStore
} from "../apps/api/dist/tenancyStore.js";

const root = await mkdtemp(
  join(tmpdir(), "oeap-multitenant-")
);

try {
  const tenancy = new TenancyStore(
    join(root, "tenancy.sqlite")
  );
  const alpha = tenancy.createOrganization({
    name: "Alpha Company",
    slug: "alpha",
    ownerName: "Alpha Owner",
    ownerEmail: "owner@alpha.test"
  });
  const beta = tenancy.createOrganization({
    name: "Beta Company",
    slug: "beta",
    ownerName: "Beta Owner",
    ownerEmail: "owner@beta.test"
  });

  const alphaOwner = alpha.members[0];
  const betaOwner = beta.members[0];

  assert(
    tenancy.authorize({
      organizationId: alpha.organization.id,
      memberId: alphaOwner.id,
      permission: "apps.manage"
    }),
    "Alpha owner must manage Alpha apps"
  );
  assert(
    !tenancy.authorize({
      organizationId: beta.organization.id,
      memberId: alphaOwner.id,
      permission: "apps.manage"
    }),
    "Alpha owner must never authenticate as a Beta member"
  );

  const betaViewerRole = beta.roles.find(
    (role) => role.name === "Viewer"
  );
  assert(Boolean(betaViewerRole), "Beta Viewer role missing");
  const betaViewer = tenancy.createMember({
    organizationId: beta.organization.id,
    name: "Beta Viewer",
    email: "viewer@beta.test",
    roleId: betaViewerRole.id,
    appIds: ["beta.app.one"],
    actorMemberId: betaOwner.id
  });

  tenancy.grantMemberAppAccess(
    betaViewer.id,
    "beta.app.two",
    betaOwner.id
  );
  assert(
    tenancy.authorize({
      organizationId: beta.organization.id,
      memberId: betaViewer.id,
      permission: "apps.read",
      appId: "beta.app.one"
    }) &&
    tenancy.authorize({
      organizationId: beta.organization.id,
      memberId: betaViewer.id,
      permission: "apps.read",
      appId: "beta.app.two"
    }),
    "Granting a second app must preserve existing scoped access"
  );

  const alphaPackage = await createDeveloperPackage(
    root,
    {
      type: "skill",
      name: "alpha-risk-skill",
      displayName: "Alpha Risk Skill",
      publisher: "alpha"
    },
    alpha.organization.id
  );

  const alphaDrafts = await listDeveloperPackages(
    root,
    alpha.organization.id
  );
  const betaDrafts = await listDeveloperPackages(
    root,
    beta.organization.id
  );

  assert(
    alphaDrafts.some((item) => item.id === alphaPackage.id),
    "Alpha must see its own Developer draft"
  );
  assert(
    !betaDrafts.some((item) => item.id === alphaPackage.id),
    "Beta must not see Alpha Developer drafts"
  );

  await publishDeveloperPackage(
    root,
    alphaPackage.id,
    alpha.organization.id
  );

  const alphaPublished = await listPublishedPackages(
    root,
    alpha.organization.id
  );
  const betaPublished = await listPublishedPackages(
    root,
    beta.organization.id
  );

  assert(
    alphaPublished.some((item) => item.id === alphaPackage.id),
    "Alpha Marketplace must contain Alpha published Package"
  );
  assert(
    !betaPublished.some((item) => item.id === alphaPackage.id),
    "Beta Marketplace must not contain Alpha published Package"
  );

  const activation = new OrganizationPackageStore(
    join(root, "organization-packages.sqlite")
  );
  activation.set(
    alpha.organization.id,
    "oeap.example",
    "enabled"
  );
  activation.set(
    beta.organization.id,
    "oeap.example",
    "disabled"
  );

  assert(
    activation.get(
      alpha.organization.id,
      "oeap.example"
    ) === "enabled",
    "Alpha activation state must remain enabled"
  );
  assert(
    activation.get(
      beta.organization.id,
      "oeap.example"
    ) === "disabled",
    "Beta activation state must remain disabled"
  );
  assert(
    activation.countEnabled("oeap.example") === 1,
    "Global runtime reference count must reflect only enabled organizations"
  );

  console.log(
    "✅ MULTI-TENANT ISOLATION TEST PASSED"
  );
} finally {
  await rm(root, {
    recursive: true,
    force: true
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
