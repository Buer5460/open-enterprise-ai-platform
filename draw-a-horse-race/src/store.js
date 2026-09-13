import fs from "node:fs";
import path from "node:path";

const DATA_FILE = path.resolve(process.env.DATA_FILE || "data/store.json");
const initialState = () => ({ users: {}, rooms: {}, races: [], purchases: [], meta: { createdAt: Date.now() } });
let state = initialState();

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function ensureUserShape(user) {
  if (!user.stats) user.stats = {};
  user.stats.races = Number(user.stats.races || 0);
  user.stats.wins = Number(user.stats.wins || 0);
  user.stats.podiums = Number(user.stats.podiums || 0);
  user.stats.pointsWon = Number(user.stats.pointsWon || 0);
  if (!user.referrals) {
    user.referrals = { total: 0, pointsEarned: 0, todayKey: null, todayCount: 0, invitees: [] };
  }
  user.referrals.total = Number(user.referrals.total || 0);
  user.referrals.pointsEarned = Number(user.referrals.pointsEarned || 0);
  user.referrals.todayCount = Number(user.referrals.todayCount || 0);
  if (!Array.isArray(user.referrals.invitees)) user.referrals.invitees = [];
  return user;
}

function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const parsed = safeParse(fs.readFileSync(DATA_FILE, "utf8"));
    if (parsed && typeof parsed === "object") {
      state = { ...initialState(), ...parsed };
      for (const user of Object.values(state.users || {})) ensureUserShape(user);
    }
  } catch (error) {
    console.warn("store load failed:", error.message);
  }
}

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
load();

export function getOrCreateUser(userId, profile = {}) {
  if (!userId) throw new Error("userId required");
  if (!state.users[userId]) {
    state.users[userId] = {
      id: userId,
      name: String(profile.name || "玩家").slice(0, 20),
      points: 200,
      lastDaily: null,
      horse: null,
      stats: { races: 0, wins: 0, podiums: 0, pointsWon: 0 },
      referrals: { total: 0, pointsEarned: 0, todayKey: null, todayCount: 0, invitees: [] },
      referredBy: null,
      referredAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    save();
  }
  return ensureUserShape(state.users[userId]);
}

export function updateUser(userId, patch = {}) {
  const user = getOrCreateUser(userId);
  if (patch.name) user.name = String(patch.name).slice(0, 20);
  if (patch.horse) user.horse = patch.horse;
  user.updatedAt = Date.now();
  save();
  return user;
}

export function claimDaily(userId, dateKey) {
  const user = getOrCreateUser(userId);
  if (user.lastDaily === dateKey) return { ok: false, user };
  user.lastDaily = dateKey;
  user.points += 100;
  user.updatedAt = Date.now();
  save();
  return { ok: true, user };
}

export function spendPoints(userId, amount) {
  const user = getOrCreateUser(userId);
  const value = Math.max(0, Math.round(Number(amount || 0)));
  if (!value || user.points < value) return false;
  user.points -= value;
  user.updatedAt = Date.now();
  save();
  return true;
}

export function addPoints(userId, amount) {
  const user = getOrCreateUser(userId);
  const value = Math.max(0, Math.round(Number(amount || 0)));
  user.points += value;
  user.updatedAt = Date.now();
  save();
  return user;
}

export function awardReferral(referrerId, inviteeId, dateKey, reward = 50, maxDaily = 5) {
  const refId = String(referrerId || "").trim();
  const newId = String(inviteeId || "").trim();
  if (!refId || !newId || refId === newId) return { ok: false, reason: "invalid" };
  const referrer = state.users[refId];
  if (!referrer) return { ok: false, reason: "referrer_not_found" };
  ensureUserShape(referrer);
  const invitee = getOrCreateUser(newId);
  if (invitee.referredBy) return { ok: false, reason: "already_referred" };
  if (referrer.referrals.invitees.includes(newId)) return { ok: false, reason: "duplicate" };
  if (referrer.referrals.todayKey !== dateKey) {
    referrer.referrals.todayKey = dateKey;
    referrer.referrals.todayCount = 0;
  }
  if (referrer.referrals.todayCount >= maxDaily) return { ok: false, reason: "daily_limit" };
  const value = Math.max(0, Math.round(Number(reward || 0)));
  referrer.points += value;
  referrer.referrals.total += 1;
  referrer.referrals.pointsEarned += value;
  referrer.referrals.todayCount += 1;
  referrer.referrals.invitees.push(newId);
  referrer.referrals.invitees = referrer.referrals.invitees.slice(-500);
  referrer.updatedAt = Date.now();
  invitee.referredBy = refId;
  invitee.referredAt = Date.now();
  invitee.updatedAt = Date.now();
  save();
  return { ok: true, reward: value, referrerId: refId, inviteeId: newId, points: referrer.points, total: referrer.referrals.total, todayCount: referrer.referrals.todayCount, maxDaily };
}

export function getUser(userId) { return getOrCreateUser(userId); }

export function saveRoomSnapshot(room) {
  state.rooms[room.code] = { code: room.code, hostId: room.hostId, status: room.status, createdAt: room.createdAt, updatedAt: Date.now(), players: room.players.map(({ socketId, ...p }) => p), race: room.race || null };
  save();
}

export function removeRoomSnapshot(code) { delete state.rooms[code]; save(); }

export function loadRoomSnapshots() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return Object.values(state.rooms || {}).filter(r => (r.updatedAt || r.createdAt || 0) >= cutoff);
}

export function recordRace({ roomCode, raceId, results, winnerId }) {
  const item = { roomCode, raceId, results, winnerId, finishedAt: Date.now() };
  state.races.unshift(item);
  state.races = state.races.slice(0, 500);
  results.forEach(r => {
    if (String(r.playerId).startsWith("bot_")) return;
    const user = getOrCreateUser(r.playerId, { name: r.name });
    user.stats.races += 1;
    if (r.rank === 1) user.stats.wins += 1;
    if (r.rank <= 3) user.stats.podiums += 1;
    user.updatedAt = Date.now();
  });
  save();
  return item;
}

export function addPointsWon(userId, amount) {
  const user = getOrCreateUser(userId);
  user.stats.pointsWon += Math.max(0, Math.round(amount));
  save();
}

export function leaderboard(limit = 30) {
  return Object.values(state.users)
    .filter(u => !String(u.id).startsWith("bot_"))
    .map(u => { ensureUserShape(u); return { id: u.id, name: u.name || u.horse?.name || "玩家", points: u.points, stats: u.stats, horse: u.horse ? { name: u.horse.name } : null }; })
    .sort((a, b) => b.stats.wins - a.stats.wins || b.stats.podiums - a.stats.podiums || b.stats.races - a.stats.races)
    .slice(0, limit);
}

export function recentRaces(limit = 50) { return state.races.slice(0, limit); }

export function recordPurchase(purchase) {
  state.purchases.unshift({ ...purchase, createdAt: Date.now() });
  state.purchases = state.purchases.slice(0, 500);
  save();
}

export function adminStats(liveRooms = 0) {
  const users = Object.values(state.users);
  users.forEach(ensureUserShape);
  return {
    users: users.length,
    liveRooms,
    races: state.races.length,
    purchases: state.purchases.length,
    referrals: users.reduce((sum, u) => sum + (u.referrals?.total || 0), 0),
    referralPoints: users.reduce((sum, u) => sum + (u.referrals?.pointsEarned || 0), 0),
    totalPoints: users.reduce((sum, u) => sum + (u.points || 0), 0),
    generatedAt: Date.now()
  };
}
