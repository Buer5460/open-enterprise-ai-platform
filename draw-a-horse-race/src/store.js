import fs from "node:fs";
import path from "node:path";

const DATA_FILE = path.resolve("data/store.json");
let state = { users: {}, rooms: {} };

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    console.warn("store load failed:", error.message);
  }
}
function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}
load();

export function getOrCreateUser(userId) {
  if (!state.users[userId]) {
    state.users[userId] = { id: userId, points: 200, lastDaily: null, createdAt: Date.now() };
    save();
  }
  return state.users[userId];
}
export function claimDaily(userId, dateKey) {
  const user = getOrCreateUser(userId);
  if (user.lastDaily === dateKey) return { ok: false, user };
  user.lastDaily = dateKey;
  user.points += 100;
  save();
  return { ok: true, user };
}
export function spendPoints(userId, amount) {
  const user = getOrCreateUser(userId);
  if (amount <= 0 || user.points < amount) return false;
  user.points -= amount;
  save();
  return true;
}
export function addPoints(userId, amount) {
  const user = getOrCreateUser(userId);
  user.points += Math.max(0, Math.round(amount));
  save();
  return user;
}
export function getUser(userId) { return getOrCreateUser(userId); }
