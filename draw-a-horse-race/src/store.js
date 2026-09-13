import fs from "node:fs";
import path from "node:path";

const DATA_FILE = path.resolve(process.env.DATA_FILE || "data/store.json");
const initialState = () => ({ users: {}, rooms: {}, races: [], purchases: [], meta: { createdAt: Date.now() } });
let state = initialState();

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}
function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const parsed = safeParse(fs.readFileSync(DATA_FILE, "utf8"));
    if (parsed && typeof parsed === "object") state = { ...initialState(), ...parsed };
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
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    save();
  }
  return state.users[userId];
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

export function getUser(userId) { return getOrCreateUser(userId); }

export function saveRoomSnapshot(room) {
  state.rooms[room.code] = {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    createdAt: room.createdAt,
    updatedAt: Date.now(),
    players: room.players.map(({ socketId, ...p }) => p),
    race: room.race || null
  };
  save();
}

export function removeRoomSnapshot(code) {
  delete state.rooms[code];
  save();
}

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
    .map(u => ({ id: u.id, name: u.name || u.horse?.name || "玩家", points: u.points, stats: u.stats, horse: u.horse ? { name: u.horse.name } : null }))
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
  return {
    users: users.length,
    liveRooms,
    races: state.races.length,
    purchases: state.purchases.length,
    totalPoints: users.reduce((sum, u) => sum + (u.points || 0), 0),
    generatedAt: Date.now()
  };
}
