import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horse-ref-'));
process.env.DATA_FILE = path.join(dir, 'store.json');
const store = await import(`../src/store.js?test=${Date.now()}`);

test('referral rewards inviter once for a distinct invitee', () => {
  store.getOrCreateUser('inviter');
  store.getOrCreateUser('friend');
  const first = store.awardReferral('inviter', 'friend', '2026-09-13', 50, 5);
  assert.equal(first.ok, true);
  assert.equal(store.getUser('inviter').points, 250);
  assert.equal(store.getUser('inviter').referrals.total, 1);
  const again = store.awardReferral('inviter', 'friend', '2026-09-13', 50, 5);
  assert.equal(again.ok, false);
  assert.equal(store.getUser('inviter').points, 250);
});

test('referral reward respects daily cap', () => {
  store.getOrCreateUser('capper');
  for (let i = 0; i < 5; i++) {
    store.getOrCreateUser(`friend-${i}`);
    assert.equal(store.awardReferral('capper', `friend-${i}`, '2026-09-13', 50, 5).ok, true);
  }
  store.getOrCreateUser('friend-5');
  const over = store.awardReferral('capper', 'friend-5', '2026-09-13', 50, 5);
  assert.equal(over.ok, false);
  assert.equal(over.reason, 'daily_limit');
  assert.equal(store.getUser('capper').referrals.todayCount, 5);
});
