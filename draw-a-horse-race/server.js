import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import QRCode from "qrcode";
import { buildRacePlan } from "./src/race-engine.js";
import {
  addPoints, addPointsWon, adminStats, awardReferral, claimDaily, getUser, leaderboard, loadRoomSnapshots,
  recordRace, recentRaces, removeRoomSnapshot, saveRoomSnapshot, spendPoints, updateUser
} from "./src/store.js";
import { createPayment, paymentConfig, SHOP } from "./src/payment/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3088);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const REFERRAL_REWARD = 50;
const REFERRAL_DAILY_MAX = 5;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public"), { etag: true, maxAge: 0, setHeaders(res, filePath){ if (/\.(html|js|css)$/i.test(filePath)) res.setHeader("Cache-Control", "no-cache"); } }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, transports: ["websocket", "polling"] });

const rooms = new Map();
for (const snapshot of loadRoomSnapshots()) {
  if (snapshot.status === "racing") {
    for (const p of snapshot.players || []) if (p.bet?.amount) addPoints(p.id, p.bet.amount);
    snapshot.players = (snapshot.players || []).map(p => ({ ...p, bet: null }));
    snapshot.status = "lobby";
    snapshot.race = null;
  }
  snapshot.players = (snapshot.players || []).map(p => ({ ...p, socketId: null }));
  rooms.set(snapshot.code, snapshot);
}

function newCode() { let code; do code = String(Math.floor(1000 + Math.random() * 9000)); while (rooms.has(code)); return code; }
function cleanNumber(n, fallback=65){const v=Number(n);return Number.isFinite(v)?Math.max(40,Math.min(100,v)):fallback}
function sanitizeHorse(horse = {}) {
  return {
    name: String(horse.name || "我的小马").trim().slice(0, 12),
    image: String(horse.image || "").startsWith("data:image/") ? String(horse.image).slice(0, 2_000_000) : "",
    stats: { speed:cleanNumber(horse.stats?.speed), stamina:cleanNumber(horse.stats?.stamina), burst:cleanNumber(horse.stats?.burst), luck:cleanNumber(horse.stats?.luck) }
  };
}
function publicRoom(room) {
  return { code:room.code,hostId:room.hostId,status:room.status,createdAt:room.createdAt,players:room.players.map(({socketId,...p})=>p),betsLocked:room.status!=="lobby",raceId:room.race?.id||null };
}
function emitRoom(room){saveRoomSnapshot(room);io.to(room.code).emit("room:update",publicRoom(room))}
function findPlayer(room,userId){return room.players.find(p=>p.id===userId)}
function adminGuard(req,res,next){if(!ADMIN_TOKEN)return res.status(503).json({ok:false,message:"ADMIN_TOKEN 未配置"});if(req.query.token!==ADMIN_TOKEN&&req.headers["x-admin-token"]!==ADMIN_TOKEN)return res.status(401).json({ok:false,message:"未授权"});next()}
function todayKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function cleanRef(value){return String(value||"").trim().slice(0,100)}
function refFromReferer(referer){try{return cleanRef(new URL(String(referer||""),PUBLIC_BASE_URL).searchParams.get("ref"))}catch{return ""}}

app.get("/api/health",(_,res)=>res.json({ok:true,service:"draw-a-horse-race",version:"1.0.3",rooms:rooms.size,payment:paymentConfig()}));
app.get("/api/config",(_,res)=>res.json({minPlayers:3,maxPlayers:8,dailyPoints:100,raceDurationMs:12000,referral:{reward:REFERRAL_REWARD,maxDaily:REFERRAL_DAILY_MAX},payment:paymentConfig(),shop:Object.values(SHOP)}));
app.get("/api/user/:userId",(req,res)=>res.json(getUser(req.params.userId)));
app.put("/api/user/:userId",(req,res)=>res.json(updateUser(req.params.userId,{name:req.body?.name,horse:req.body?.horse?sanitizeHorse(req.body.horse):undefined})));
app.post("/api/user/:userId/daily",(req,res)=>res.json(claimDaily(req.params.userId,String(req.body?.dateKey||todayKey()))));
app.get("/api/rooms",(_,res)=>res.json([...rooms.values()].filter(r=>r.status==="lobby").map(publicRoom)));
app.get("/r/:code",(req,res)=>{const code=String(req.params.code||"").replace(/\D/g,"").slice(0,4);const ref=cleanRef(req.query.ref);const qs=new URLSearchParams({room:code});if(ref)qs.set("ref",ref);res.redirect(302,`/?${qs.toString()}`)});
app.get("/api/rooms/:code/qr.svg",async(req,res)=>{const code=String(req.params.code||"");const room=rooms.get(code);if(!room)return res.status(404).type("text/plain").send("房间不存在或已过期");const ref=cleanRef(req.query.ref);const suffix=ref?`?ref=${encodeURIComponent(ref)}`:"";const inviteUrl=`${PUBLIC_BASE_URL.replace(/\/$/,"")}/r/${encodeURIComponent(code)}${suffix}`;try{const svg=await QRCode.toString(inviteUrl,{type:"svg",width:320,margin:2,errorCorrectionLevel:"M",color:{dark:"#111827",light:"#ffffff"}});res.set("Cache-Control","no-store");res.type("image/svg+xml").send(svg)}catch(error){res.status(500).type("text/plain").send("二维码生成失败")}});
app.get("/api/leaderboard",(_,res)=>res.json(leaderboard(50)));
app.get("/api/races/recent",(_,res)=>res.json(recentRaces(20)));
app.get("/api/payment/config",(_,res)=>res.json({...paymentConfig(),shop:Object.values(SHOP)}));
app.post("/api/payment/create",async(req,res)=>{const out=await createPayment({userId:req.body?.userId,skuId:req.body?.skuId,returnUrl:req.body?.returnUrl});res.status(out.status||200).json(out)});
app.get("/api/admin/stats",adminGuard,(_,res)=>res.json(adminStats(rooms.size)));
app.get("/api/admin/races",adminGuard,(_,res)=>res.json(recentRaces(100)));

io.on("connection",socket=>{
  socket.data.referrerId=refFromReferer(socket.handshake.headers.referer);
  socket.on("room:create",({userId,playerName,horse},ack=()=>{})=>{if(!userId)return ack({ok:false,message:"用户标识缺失"});const code=newCode(),cleanHorse=sanitizeHorse(horse),name=String(playerName||cleanHorse.name||"房主").slice(0,12);updateUser(userId,{name,horse:cleanHorse});const room={code,hostId:userId,status:"lobby",createdAt:Date.now(),players:[{id:userId,socketId:socket.id,name,horse:cleanHorse,ready:true,bet:null}],race:null};rooms.set(code,room);socket.join(code);emitRoom(room);ack({ok:true,room:publicRoom(room),shareUrl:`${PUBLIC_BASE_URL.replace(/\/$/,"")}/r/${code}`})});

  socket.on("room:join",({code,userId,playerName,horse,referrerId},ack=()=>{})=>{const room=rooms.get(String(code));if(!room)return ack({ok:false,message:"房间不存在或已过期"});let player=findPlayer(room,userId);const isNewPlayer=!player;if(room.status!=="lobby"&&!player)return ack({ok:false,message:"比赛已经开始，不能新增参赛者"});if(!player){if(room.players.length>=8)return ack({ok:false,message:"房间已满"});const cleanHorse=sanitizeHorse(horse),name=String(playerName||cleanHorse.name||"参赛者").slice(0,12);player={id:userId,socketId:socket.id,name,horse:cleanHorse,ready:true,bet:null};room.players.push(player);updateUser(userId,{name,horse:cleanHorse})}else player.socketId=socket.id;let referralReward=null;if(isNewPlayer){const candidate=cleanRef(referrerId)||socket.data.referrerId;const candidateIsInRoom=room.players.some(p=>p.id===candidate);referralReward=candidateIsInRoom?awardReferral(candidate,userId,todayKey(),REFERRAL_REWARD,REFERRAL_DAILY_MAX):{ok:false,reason:"referrer_not_in_room"};if(referralReward?.ok){const inviter=findPlayer(room,referralReward.referrerId);if(inviter?.socketId)io.to(inviter.socketId).emit("referral:reward",referralReward)}}socket.join(room.code);emitRoom(room);ack({ok:true,room:publicRoom(room),race:room.status==="racing"?room.race:null,referralReward});if(room.status==="racing"&&room.race)socket.emit("race:plan",{race:room.race,players:publicRoom(room).players,recovery:true})});

  socket.on("room:add-bot",({code,userId},ack=()=>{})=>{const room=rooms.get(String(code));if(!room)return ack({ok:false,message:"房间不存在"});if(room.hostId!==userId)return ack({ok:false,message:"只有房主可以添加试玩马"});if(room.status!=="lobby")return ack({ok:false,message:"当前不能添加"});if(room.players.length>=8)return ack({ok:false,message:"房间已满"});const botNames=["马界毕加索","风一样的胖子","不会画马","闪电萝卜","今天要夺冠","这不是狗"];const idx=room.players.filter(p=>p.isBot).length;const id=`bot_${room.code}_${Date.now()}_${idx}`;const name=botNames[idx%botNames.length];room.players.push({id,socketId:null,name,isBot:true,horse:{name,image:"",stats:{speed:55+Math.floor(Math.random()*35),stamina:55+Math.floor(Math.random()*35),burst:55+Math.floor(Math.random()*35),luck:50+Math.floor(Math.random()*45)}},ready:true,bet:null});emitRoom(room);ack({ok:true,room:publicRoom(room)})});

  socket.on("bet:place",({code,userId,targetId,amount},ack=()=>{})=>{const room=rooms.get(String(code));if(!room||room.status!=="lobby")return ack({ok:false,message:"当前不能竞猜"});const player=findPlayer(room,userId);if(!player)return ack({ok:false,message:"你不在该房间"});const value=Math.max(10,Math.min(500,Math.floor(Number(amount||0)/10)*10));if(!room.players.some(p=>p.id===targetId))return ack({ok:false,message:"参赛马不存在"});if(player.bet?.amount)addPoints(userId,player.bet.amount);if(!spendPoints(userId,value))return ack({ok:false,message:"积分不足"});player.bet={targetId,amount:value,odds:2};emitRoom(room);ack({ok:true,points:getUser(userId).points,bet:player.bet})});

  socket.on("race:start",({code,userId},ack=()=>{})=>{const room=rooms.get(String(code));if(!room)return ack({ok:false,message:"房间不存在"});if(room.hostId!==userId)return ack({ok:false,message:"只有房主可以开赛"});if(room.players.length<3)return ack({ok:false,message:"至少 3 人才能比赛"});if(room.status!=="lobby")return ack({ok:false,message:"当前不能开赛"});room.status="racing";room.race=buildRacePlan(room.players,room.code);emitRoom(room);io.to(room.code).emit("race:plan",{race:room.race,players:publicRoom(room).players});ack({ok:true});const finishDelay=Math.max(0,room.race.startedAt-Date.now())+room.race.durationMs+450;setTimeout(()=>finishRace(room.code,room.race.id),finishDelay)});

  socket.on("room:reset",({code,userId},ack=()=>{})=>{const room=rooms.get(String(code));if(!room)return ack({ok:false,message:"房间不存在"});if(room.hostId!==userId)return ack({ok:false,message:"只有房主可以再开一局"});if(room.status!=="finished")return ack({ok:false,message:"当前不能重置"});room.status="lobby";room.race=null;room.players.forEach(p=>p.bet=null);emitRoom(room);ack({ok:true,room:publicRoom(room)})});
  socket.on("room:leave",({code,userId})=>{const room=rooms.get(String(code));if(!room)return;const idx=room.players.findIndex(p=>p.id===userId);if(idx<0)return;room.players.splice(idx,1);socket.leave(room.code);if(!room.players.length){rooms.delete(room.code);removeRoomSnapshot(room.code);return}if(room.hostId===userId)room.hostId=room.players[0].id;emitRoom(room)});
  socket.on("disconnect",()=>{for(const room of rooms.values()){const p=room.players.find(p=>p.socketId===socket.id);if(p){p.socketId=null;saveRoomSnapshot(room)}}});
});

function finishRace(code,raceId){const room=rooms.get(code);if(!room||room.status!=="racing"||room.race?.id!==raceId)return;room.status="finished";const winnerId=room.race.order[0].playerId;const betResults={};for(const player of room.players){if(!player.bet)continue;if(player.bet.targetId===winnerId){const payout=player.bet.amount*player.bet.odds;addPoints(player.id,payout);addPointsWon(player.id,payout-player.bet.amount);betResults[player.id]={won:true,payout}}else betResults[player.id]={won:false,payout:0}}const results=room.race.order.map((entry,index)=>({rank:index+1,playerId:entry.playerId,name:room.players.find(p=>p.id===entry.playerId)?.name||"参赛者",timeMs:entry.timeMs}));recordRace({roomCode:room.code,raceId:room.race.id,results,winnerId});emitRoom(room);io.to(room.code).emit("race:finish",{results,winnerId,betResults})}

server.listen(PORT,()=>console.log(`Draw a Horse running on ${PUBLIC_BASE_URL}`));
