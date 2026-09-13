const socket = io();
const $ = s => document.querySelector(s);
const screens = [...document.querySelectorAll(".screen")];

const userId = localStorage.getItem("dahr_user_id") || crypto.randomUUID();
localStorage.setItem("dahr_user_id", userId);

let points = 0;
let horse = JSON.parse(localStorage.getItem("dahr_horse") || "null");
let room = null;
let selectedBetTarget = null;
let raceAnimation = null;

function go(id) {
  screens.forEach(s => s.classList.remove("active"));
  $(`#${id}`).classList.add("active");
  scrollTo({ top: 0, behavior: "smooth" });
}
function toast(text) {
  const el = $("#toast"); el.textContent = text; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1700);
}
function dateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
async function loadUser() {
  const u = await fetch(`/api/user/${userId}`).then(r => r.json());
  points = u.points; $("#points").textContent = points;
}
await loadUser();

document.querySelectorAll("[data-go]").forEach(el => el.onclick = () => go(el.dataset.go));

$("#dailyBtn").onclick = async () => {
  const res = await fetch(`/api/user/${userId}/daily`, { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ dateKey: dateKey() }) }).then(r=>r.json());
  points = res.user.points; $("#points").textContent = points;
  toast(res.ok ? "领取 100 积分" : "今天已经领取过了");
};

const canvas = $("#drawCanvas"), ctx = canvas.getContext("2d");
ctx.lineCap = "round"; ctx.lineJoin = "round";
let drawing = false, strokes = [], current = [];
function pos(e) {
  const r=canvas.getBoundingClientRect(), p=e.touches ? e.touches[0] : e;
  return { x:(p.clientX-r.left)*canvas.width/r.width, y:(p.clientY-r.top)*canvas.height/r.height };
}
function start(e){ e.preventDefault(); drawing=true; current=[pos(e)]; strokes.push({color:$("#color").value,size:+$("#size").value,pts:current}); }
function move(e){ if(!drawing)return; e.preventDefault(); const p=pos(e), last=current[current.length-1]; current.push(p); ctx.strokeStyle=$("#color").value;ctx.lineWidth=+$("#size").value;ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke(); }
function end(){ drawing=false; current=[]; }
["mousedown","touchstart"].forEach(x=>canvas.addEventListener(x,start,{passive:false}));
["mousemove","touchmove"].forEach(x=>canvas.addEventListener(x,move,{passive:false}));
["mouseup","mouseleave","touchend"].forEach(x=>canvas.addEventListener(x,end));
function redraw(){ctx.clearRect(0,0,canvas.width,canvas.height);for(const s of strokes){ctx.strokeStyle=s.color;ctx.lineWidth=s.size;ctx.beginPath();s.pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke()}}
$("#undoBtn").onclick=()=>{strokes.pop();redraw()}; $("#clearBtn").onclick=()=>{strokes=[];redraw()};

$("#finishDrawBtn").onclick = () => {
  if (strokes.length < 2) return toast("先画几笔");
  const name = $("#horseName").value.trim() || "闪电土豆";
  const ink = strokes.reduce((a,s)=>a+s.pts.length,0);
  const seed=(name.length*37+ink*11)%97;
  horse = {
    name,
    image: canvas.toDataURL("image/png"),
    stats:{
      speed:55+(seed*7)%43,
      stamina:50+(seed*5)%47,
      burst:52+(seed*9)%45,
      luck:48+(seed*13)%50
    }
  };
  localStorage.setItem("dahr_horse", JSON.stringify(horse));
  renderHorse(); go("horse");
};
function renderHorse(){
  if(!horse)return;
  $("#horsePreview").src=horse.image; $("#horseTitle").textContent=horse.name;
  $("#horseComment").textContent="这匹马将保留你的原始画风，在赛道上完整跑完一场。";
  $("#speedStat").textContent=horse.stats.speed;$("#staminaStat").textContent=horse.stats.stamina;$("#burstStat").textContent=horse.stats.burst;$("#luckStat").textContent=horse.stats.luck;
}
if(horse) renderHorse();

function horsePayload(){
  return horse || {name:"我的小马",image:"",stats:{speed:65,stamina:65,burst:65,luck:65}};
}
function joinRoom(code){
  socket.emit("room:join",{code,userId,playerName:horsePayload().name,horse:horsePayload()},res=>{
    if(!res.ok)return toast(res.message);
    room=res.room; renderRoom(); go("room");
  });
}
$("#createRoomBtn").onclick=()=>socket.emit("room:create",{userId,playerName:horsePayload().name,horse:horsePayload()},res=>{
  if(!res.ok)return toast("创建失败");
  room=res.room; renderRoom(); history.replaceState(null,"",`?room=${room.code}`); go("room");
});
$("#joinBtn").onclick=()=>joinRoom($("#joinCode").value.trim());

function renderRoom(){
  if(!room)return;
  $("#roomCode").textContent=`#${room.code}`;
  $("#roomStatus").textContent=`${room.players.length}/8 人 · ${room.status==="lobby"?"等待开赛":room.status}`;
  $("#players").innerHTML=room.players.map(p=>`<div class="player"><div class="avatar">${p.horse?.image?`<img src="${p.horse.image}">`:"🐎"}</div><div class="grow"><b>${p.name}</b><div class="mini">${p.id===room.hostId?"房主":"参赛者"}</div></div></div>`).join("");
  const start=$("#startRaceBtn");
  const canStart=room.players.length>=3 && room.hostId===userId && room.status==="lobby";
  start.disabled=!canStart;
  start.textContent=room.hostId===userId?(room.players.length>=3?"开始比赛":"至少 3 人才能开始"):"等待房主开赛";
}
socket.on("room:update", next=>{ if(room && next.code===room.code){room=next;renderRoom();} });

$("#shareBtn").onclick=async()=>{
  if(!room)return;
  const url=`${location.origin}${location.pathname}?room=${room.code}`;
  const data={title:"Draw a Horse · Then Race It",text:`加入我的赛马房间 #${room.code}`,url};
  if(navigator.share){try{await navigator.share(data);return}catch{}}
  await navigator.clipboard?.writeText(url);toast("房间链接已复制");
};

$("#betOpenBtn").onclick=()=>{
  if(!room || room.status!=="lobby")return toast("当前不能竞猜");
  selectedBetTarget=null;
  $("#betList").innerHTML=room.players.map(p=>`<div class="bet-option" data-id="${p.id}"><div class="avatar">${p.horse?.image?`<img src="${p.horse.image}">`:"🐎"}</div><div class="grow"><b>${p.name}</b><div class="mini">固定积分返还倍率 ×2</div></div></div>`).join("");
  document.querySelectorAll(".bet-option").forEach(el=>el.onclick=()=>{document.querySelectorAll(".bet-option").forEach(x=>x.classList.remove("active"));el.classList.add("active");selectedBetTarget=el.dataset.id});
  go("bet");
};
$("#confirmBetBtn").onclick=()=>{
  if(!selectedBetTarget)return toast("请选择一匹马");
  const amount=Number($("#betAmount").value||20);
  socket.emit("bet:place",{code:room.code,userId,targetId:selectedBetTarget,amount},res=>{
    if(!res.ok)return toast(res.message);
    points=res.points;$("#points").textContent=points;toast("竞猜成功");go("room");
  });
};

$("#startRaceBtn").onclick=()=>socket.emit("race:start",{code:room.code,userId},res=>{if(!res.ok)toast(res.message)});
socket.on("race:plan", payload=>{
  if(!room || !payload.players.some(p=>p.id===userId)) return;
  playRace(payload);
});

function makeTrack(players){
  const track=$("#track");
  track.querySelectorAll(".runner,.lane-line").forEach(x=>x.remove());
  const topStart=30, usable=64;
  players.forEach((p,i)=>{
    const y=topStart + i*(usable/Math.max(1,players.length));
    const line=document.createElement("div");line.className="lane-line";line.style.top=`${y+7}%`;track.appendChild(line);
    const runner=document.createElement("div");runner.className="runner";runner.dataset.playerId=p.id;runner.style.top=`${y}%`;
    runner.innerHTML=`<span class="runner-name">${p.name}</span>${p.horse?.image?`<img src="${p.horse.image}">`:`<span class="emoji">🐎</span>`}`;
    track.appendChild(runner);
  });
}
function playRace({race,players}){
  go("race"); makeTrack(players);
  $("#commentary").textContent="所有马匹进入闸门，准备起跑……";
  const runners=players.map(p=>document.querySelector(`.runner[data-player-id="${p.id}"]`));
  const countdown=$("#countdown");
  const wait=Math.max(0,race.startedAt-Date.now());
  let n=3;countdown.textContent=n;
  const cd=setInterval(()=>{n--;countdown.textContent=n>0?n:n===0?"GO!":"";if(n<0)clearInterval(cd)},800);

  setTimeout(()=>{
    countdown.textContent="";
    const start=performance.now();
    let eventIndex=0;
    const maxX=()=>$("#track").clientWidth-115;
    function frame(now){
      const elapsed=Math.min(race.durationMs,now-start);
      const idx=Math.min(race.frames.length-2,Math.floor(elapsed/race.stepMs));
      const a=race.frames[idx],b=race.frames[idx+1]||a;
      const local=(elapsed-a.timeMs)/Math.max(1,b.timeMs-a.timeMs);
      const positions=a.positions.map((v,i)=>v+(b.positions[i]-v)*local);
      positions.forEach((v,i)=>runners[i].style.transform=`translateX(${v*maxX()}px)`);
      const leaderIndex=positions.indexOf(Math.max(...positions));
      $("#leaderText").textContent=`领先：${players[leaderIndex].name}`;
      $("#raceClock").textContent=`${(elapsed/1000).toFixed(1)}s / ${(race.durationMs/1000).toFixed(0)}s`;
      $("#raceProgress").style.width=`${elapsed/race.durationMs*100}%`;

      while(eventIndex<race.events.length && elapsed>=race.events[eventIndex].timeMs){
        $("#commentary").textContent=race.events[eventIndex].text;eventIndex++;
      }
      if(elapsed<race.durationMs) raceAnimation=requestAnimationFrame(frame);
    }
    raceAnimation=requestAnimationFrame(frame);
  },wait);
}

socket.on("race:finish", async ({results})=>{
  await loadUser();
  $("#results").innerHTML=results.map(r=>`<div class="result-row"><b style="width:28px">${["🥇","🥈","🥉"][r.rank-1]||r.rank}</b><div class="grow"><b>${r.name}</b><div class="mini">${(r.timeMs/1000).toFixed(2)} 秒</div></div></div>`).join("");
  setTimeout(()=>go("result"),700);
});
$("#rematchBtn").onclick=()=>go("room");

const initialRoom=new URLSearchParams(location.search).get("room");
if(initialRoom){$("#joinCode").value=initialRoom;go("join");toast(`房间 #${initialRoom}，画马后即可加入`);}
