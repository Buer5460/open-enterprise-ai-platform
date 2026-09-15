import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  AppPreferenceStore
} from "../apps/api/dist/appPreferenceStore.js";

const root = await mkdtemp(
  join(tmpdir(), "oeap-app-preferences-")
);

try {
  const database = join(root, "preferences.sqlite");
  const store = new AppPreferenceStore(database);

  const ownerFavorite = store.update({
    organizationId: "org_a",
    memberId: "member_owner",
    appId: "app_crm",
    favorite: true,
    folder: "销售"
  });
  assert.equal(ownerFavorite.favorite, true);
  assert.equal(ownerFavorite.folder, "销售");
  assert.equal(ownerFavorite.memberId, "member_owner");

  const opened = store.markOpened({
    organizationId: "org_a",
    memberId: "member_owner",
    appId: "app_crm"
  });
  assert.ok(opened.lastOpenedAt);
  assert.equal(opened.favorite, true);
  assert.equal(opened.folder, "销售");

  const otherMember = store.get(
    "org_a",
    "member_sales",
    "app_crm"
  );
  assert.equal(otherMember.favorite, false);
  assert.equal(otherMember.folder, undefined);
  assert.equal(otherMember.lastOpenedAt, undefined);

  store.update({
    organizationId: "org_a",
    memberId: "member_sales",
    appId: "app_crm",
    favorite: false,
    folder: "客户"
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
  assert.equal(ownerList[0].folder, "销售");
  assert.equal(salesList[0].favorite, false);
  assert.equal(salesList[0].folder, "客户");
  assert.ok(ownerList[0].lastOpenedAt);
  assert.ok(salesList[0].lastOpenedAt);

  const clearedFolder = store.update({
    organizationId: "org_a",
    memberId: "member_sales",
    appId: "app_crm",
    folder: null
  });
  assert.equal(clearedFolder.folder, undefined);
  assert.equal(clearedFolder.favorite, false);
  assert.ok(clearedFolder.lastOpenedAt);

  const otherOrganization = store.get(
    "org_b",
    "member_owner",
    "app_crm"
  );
  assert.equal(otherOrganization.favorite, false);
  assert.equal(otherOrganization.folder, undefined);
  assert.equal(otherOrganization.lastOpenedAt, undefined);

  const reloaded = new AppPreferenceStore(database);
  const reloadedOwner = reloaded.get(
    "org_a",
    "member_owner",
    "app_crm"
  );
  assert.equal(
    reloadedOwner.favorite,
    true,
    "preferences must survive process/store reload"
  );
  assert.equal(
    reloadedOwner.folder,
    "销售",
    "member app folder must survive process/store reload"
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

  const legacyDatabase = join(root, "legacy-preferences.sqlite");
  const legacy = new DatabaseSync(legacyDatabase);
  legacy.exec(`
    CREATE TABLE member_app_preferences (
      organization_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      app_id TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (organization_id, member_id, app_id)
    );
    INSERT INTO member_app_preferences (
      organization_id,
      member_id,
      app_id,
      favorite
    ) VALUES ('org_legacy', 'member_legacy', 'app_legacy', 1);
  `);
  legacy.close();

  const migrated = new AppPreferenceStore(legacyDatabase);
  const migratedPreference = migrated.get(
    "org_legacy",
    "member_legacy",
    "app_legacy"
  );
  assert.equal(migratedPreference.favorite, true);
  assert.equal(migratedPreference.folder, undefined);
  const migratedWithFolder = migrated.update({
    organizationId: "org_legacy",
    memberId: "member_legacy",
    appId: "app_legacy",
    folder: "历史系统"
  });
  assert.equal(migratedWithFolder.folder, "历史系统");

  console.log("✅ APP PREFERENCES ISOLATION + FOLDER MIGRATION TEST PASSED");
} finally {
  await rm(root, {
    recursive: true,
    force: true
  });
}
