import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRacePlan } from "./src/race-engine.js";
import { addPoints, claimDaily, getUser, spendPoints } from "./src/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3088);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = new Map();

function newCode() {
  let code;
  do code = String(Math.floor(1000 + Math.random() * 9000));
  while (rooms.has(code));
  return code;
}
function sanitizeHorse(horse = {}) {
  return {
    name: String(horse.name || "我的小马").slice(0, 12),
    image: String(horse.image || "").slice(0, 2_000_000),
    stats: {
      speed: Number(horse.stats?.speed || 65),
      stamina: Number(horse.stats?.stamina || 65),
      burst: Number(horse.stats?.burst || 65),
      luck: Number(horse.stats?.luck || 65)
    }
  };
}
function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    players: room.players.map(({ socketId, ...p }) => p),
    betsLocked: room.status !== "lobby"
  };
}
function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}
function findPlayer(room, userId) {
  return room.players.find(p => p.id === userId);
}

app.get("/api/health", (_, res) => res.json({ ok: true, service: "draw-a-horse-race" }));
app.get("/api/user/:userId", (req, res) => res.json(getUser(req.params.userId)));
app.post("/api/user/:userId/daily", (req, res) => {
  const dateKey = String(req.body?.dateKey || new Date().toISOString().slice(0, 10));
  const result = claimDaily(req.params.userId, dateKey);
  res.json(result);
});
app.get("/api/rooms", (_, res) => {
  res.json([...rooms.values()].filter(r => r.status === "lobby").map(publicRoom));
});

// Payment placeholder. Production implementation must happen server-side and call Yeepay aggpay/pre-pay.
// Do not place Yeepay private keys in browser code or GitHub.
app.post("/api/payment/create", (req, res) => {
  res.status(501).json({
    ok: false,
    message: "Payment adapter is intentionally not enabled in this MVP.",
    provider: "Yeepay",
    api: "/rest/v1.0/aggpay/pre-pay"
  });
});

io.on("connection", socket => {
  socket.on("room:create", ({ userId, playerName, horse }, ack = () => {}) => {
    const code = newCode();
    const room = {
      code,
      hostId: userId,
      status: "lobby",
      players: [{
        id: userId, socketId: socket.id, name: String(playerName || horse?.name || "房主").slice(0, 12),
        horse: sanitizeHorse(horse), ready: true, bet: null
      }],
      race: null
    };
    rooms.set(code, room);
    socket.join(code);
    ack({ ok: true, room: publicRoom(room), shareUrl: `${PUBLIC_BASE_URL}/?room=${code}` });
    emitRoom(room);
  });

  socket.on("room:join", ({ code, userId, playerName, horse }, ack = () => {}) => {
    const room = rooms.get(String(code));
    if (!room) return ack({ ok: false, message: "房间不存在" });
    if (room.status !== "lobby") return ack({ ok: false, message: "比赛已经开始" });
    let player = findPlayer(room, userId);
    if (!player) {
      if (room.players.length >= 8) return ack({ ok: false, message: "房间已满" });
      player = {
        id: userId, socketId: socket.id, name: String(playerName || horse?.name || "参赛者").slice(0, 12),
        horse: sanitizeHorse(horse), ready: true, bet: null
      };
      room.players.push(player);
    } else {
      player.socketId = socket.id;
    }
    socket.join(room.code);
    ack({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("bet:place", ({ code, userId, targetId, amount }, ack = () => {}) => {
    const room = rooms.get(String(code));
    if (!room || room.status !== "lobby") return ack({ ok: false, message: "当前不能竞猜" });
    const player = findPlayer(room, userId);
    if (!player) return ack({ ok: false, message: "你不在该房间" });
    const value = Math.max(10, Math.min(500, Math.floor(Number(amount || 0) / 10) * 10));
    if (!room.players.some(p => p.id === targetId)) return ack({ ok: false, message: "参赛马不存在" });

    if (player.bet?.amount) addPoints(userId, player.bet.amount);
    if (!spendPoints(userId, value)) return ack({ ok: false, message: "积分不足" });

    player.bet = { targetId, amount: value, odds: 2 };
    ack({ ok: true, points: getUser(userId).points, bet: player.bet });
    emitRoom(room);
  });

  socket.on("race:start", ({ code, userId }, ack = () => {}) => {
    const room = rooms.get(String(code));
    if (!room) return ack({ ok: false, message: "房间不存在" });
    if (room.hostId !== userId) return ack({ ok: false, message: "只有房主可以开赛" });
    if (room.players.length < 3) return ack({ ok: false, message: "至少 3 人才能比赛" });
    if (room.status !== "lobby") return ack({ ok: false, message: "比赛已开始" });

    room.status = "racing";
    room.race = buildRacePlan(room.players, room.code);
    emitRoom(room);
    io.to(room.code).emit("race:plan", {
      race: room.race,
      players: publicRoom(room).players
    });
    ack({ ok: true });

    setTimeout(() => {
      room.status = "finished";
      const winnerId = room.race.order[0].playerId;
      for (const player of room.players) {
        if (player.bet?.targetId === winnerId) {
          addPoints(player.id, player.bet.amount * player.bet.odds);
        }
      }
      const results = room.race.order.map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: room.players.find(p => p.id === entry.playerId)?.name || "参赛者",
        timeMs: entry.timeMs
      }));
      io.to(room.code).emit("race:finish", { results, winnerId });
      emitRoom(room);
    }, Math.max(0, room.race.startedAt - Date.now()) + room.race.durationMs + 600);
  });

  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      const player = room.players.find(p => p.socketId === socket.id);
      if (player) player.socketId = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Draw a Horse running on ${PUBLIC_BASE_URL}`);
});
