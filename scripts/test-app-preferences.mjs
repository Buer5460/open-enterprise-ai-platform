import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AppPreferenceStore
} from "../apps/api/dist/appPreferenceStore.js";

const root = await mkdtemp(
  join(tmpdir(), "oeap-app-preferences-")
);

try {
  const database = join(root, "preferences.sqlite");
  const store = new AppPreferenceStore(database);

  const ownerFavorite = store.setFavorite({
    organizationId: "org_a",
    memberId: "member_owner",
    appId: "app_crm",
    favorite: true
  });
  assert.equal(ownerFavorite.favorite, true);
  assert.equal(ownerFavorite.memberId, "member_owner");

  const opened = store.markOpened({
    organizationId: "org_a",
    memberId: "member_owner",
    appId: "app_crm"
  });
  assert.ok(opened.lastOpenedAt);
  assert.equal(opened.favorite, true);

  const otherMember = store.get(
    "org_a",
    "member_sales",
    "app_crm"
  );
  assert.equal(otherMember.favorite, false);
  assert.equal(otherMember.lastOpenedAt, undefined);

  store.setFavorite({
    organizationId: "org_a",
    memberId: "member_sales",
    appId: "app_crm",
    favorite: false
  });
  store.markOpened({
    organizationId: "org_a",
    memberId: "member_sales",
    appId: "app_crm"
  });

  const ownerList = store.list(
    "org_a",
    "member_owner"
  );
  const salesList = store.list(
    "org_a",
    "member_sales"
  );
  assert.equal(ownerList.length, 1);
  assert.equal(salesList.length, 1);
  assert.equal(ownerList[0].favorite, true);
  assert.equal(salesList[0].favorite, false);
  assert.ok(ownerList[0].lastOpenedAt);
  assert.ok(salesList[0].lastOpenedAt);

  const otherOrganization = store.get(
    "org_b",
    "member_owner",
    "app_crm"
  );
  assert.equal(otherOrganization.favorite, false);
  assert.equal(otherOrganization.lastOpenedAt, undefined);

  const reloaded = new AppPreferenceStore(database);
  assert.equal(
    reloaded.get(
      "org_a",
      "member_owner",
      "app_crm"
    ).favorite,
    true,
    "preferences must survive process/store reload"
  );

  assert.equal(
    reloaded.removeApp("org_a", "app_crm"),
    2,
    "app removal should clean preferences for all members in the organization"
  );
  assert.equal(
    reloaded.list("org_a", "member_owner").length,
    0
  );
  assert.equal(
    reloaded.list("org_a", "member_sales").length,
    0
  );

  console.log("✅ APP PREFERENCES ISOLATION TEST PASSED");
} finally {
  await rm(root, {
    recursive: true,
    force: true
  });
}
