const socket=io();const $=s=>document.querySelector(s);const screens=[...document.querySelectorAll(".screen")];
const userId=localStorage.getItem("dahr_user_id")||crypto.randomUUID();localStorage.setItem("dahr_user_id",userId);
let points=0,horse=JSON.parse(localStorage.getItem("dahr_horse")||"null"),room=null,selectedBetTarget=null,raceAnimation=null,pendingRoom=new URLSearchParams(location.search).get("room"),lastResults=null,lastBetResult=null;
function go(id){screens.forEach(s=>s.classList.remove("active"));$(`#${id}`).classList.add("active");scrollTo({top:0,behavior:"smooth"});if(id==="leaderboard")loadLeaderboard();if(id==="shop")loadShop()}
function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),1800)}
function dateKey(){const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
async function loadUser(){const u=await fetch(`/api/user/${userId}`).then(r=>r.json());points=u.points;$("#points").textContent=points;return u}await loadUser();
document.querySelectorAll("[data-go]").forEach(el=>el.onclick=()=>go(el.dataset.go));
$("#dailyBtn").onclick=async()=>{const r=await fetch(`/api/user/${userId}/daily`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({dateKey:dateKey()})}).then(r=>r.json());points=r.user.points;$("#points").textContent=points;toast(r.ok?"领取 100 积分":"今天已经领取过了")};

const canvas=$("#drawCanvas"),ctx=canvas.getContext("2d");ctx.lineCap="round";ctx.lineJoin="round";let drawing=false,strokes=[],current=[];
function pos(e){const r=canvas.getBoundingClientRect(),p=e.touches?e.touches[0]:e;return{x:(p.clientX-r.left)*canvas.width/r.width,y:(p.clientY-r.top)*canvas.height/r.height}}
function start(e){e.preventDefault();drawing=true;current=[pos(e)];strokes.push({color:$("#color").value,size:+$("#size").value,pts:current})}function move(e){if(!drawing)return;e.preventDefault();const p=pos(e),last=current.at(-1);current.push(p);ctx.strokeStyle=$("#color").value;ctx.lineWidth=+$("#size").value;ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke()}function end(){drawing=false;current=[]}
["mousedown","touchstart"].forEach(x=>canvas.addEventListener(x,start,{passive:false}));["mousemove","touchmove"].forEach(x=>canvas.addEventListener(x,move,{passive:false}));["mouseup","mouseleave","touchend"].forEach(x=>canvas.addEventListener(x,end));
function redraw(){ctx.clearRect(0,0,canvas.width,canvas.height);for(const s of strokes){ctx.strokeStyle=s.color;ctx.lineWidth=s.size;ctx.beginPath();s.pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke()}}$("#undoBtn").onclick=()=>{strokes.pop();redraw()};$("#clearBtn").onclick=()=>{strokes=[];redraw()};
$("#finishDrawBtn").onclick=async()=>{if(strokes.length<2)return toast("先画几笔");const name=$("#horseName").value.trim()||"闪电土豆",ink=strokes.reduce((a,s)=>a+s.pts.length,0),seed=(name.length*37+ink*11)%97;horse={name,image:canvas.toDataURL("image/png"),stats:{speed:55+(seed*7)%43,stamina:50+(seed*5)%47,burst:52+(seed*9)%45,luck:48+(seed*13)%50}};localStorage.setItem("dahr_horse",JSON.stringify(horse));await fetch(`/api/user/${userId}`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({name:horse.name,horse})});renderHorse();if(pendingRoom){const code=pendingRoom;pendingRoom=null;joinRoom(code)}else go("horse")};
function renderHorse(){if(!horse)return;$("#horsePreview").src=horse.image;$("#horseTitle").textContent=horse.name;$("#horseComment").textContent="这匹马会保留你的原始画风参加完整赛程。";$("#speedStat").textContent=horse.stats.speed;$("#staminaStat").textContent=horse.stats.stamina;$("#burstStat").textContent=horse.stats.burst;$("#luckStat").textContent=horse.stats.luck}if(horse)renderHorse();
$("#myHorseBtn").onclick=()=>horse?go("horse"):go("draw");
function horsePayload(){return horse||{name:"我的小马",image:"",stats:{speed:65,stamina:65,burst:65,luck:65}}}
function ensureHorseThen(action){if(horse)return action();pendingRoom=typeof action==="string"?action:null;$("#drawHint").textContent=pendingRoom?`先画一匹马，完成后自动加入房间 #${pendingRoom}`:"先画一匹自己的马";go("draw")}

$("#createRoomBtn").onclick=()=>socket.emit("room:create",{userId,playerName:horsePayload().name,horse:horsePayload()},res=>{if(!res.ok)return toast(res.message||"创建失败");room=res.room;history.replaceState(null,"",`?room=${room.code}`);renderRoom();go("room")});
function joinRoom(code){if(!horse){pendingRoom=code;$("#drawHint").textContent=`先画一匹马，完成后自动加入房间 #${code}`;return go("draw")}socket.emit("room:join",{code,userId,playerName:horse.name,horse},res=>{if(!res.ok)return toast(res.message);room=res.room;history.replaceState(null,"",`?room=${room.code}`);renderRoom();go("room");if(res.race)playRace({race:res.race,players:room.players,recovery:true})})}
$("#joinBtn").onclick=()=>joinRoom($("#joinCode").value.trim());
function renderRoom(){if(!room)return;$("#roomCode").textContent=`#${room.code}`;$("#roomStatus").textContent=`${room.players.length}/8 人 · ${room.status==="lobby"?"等待开赛":room.status==="racing"?"比赛中":"已结束"}`;$("#players").innerHTML=room.players.map(p=>`<div class="player"><div class="avatar">${p.horse?.image?`<img src="${p.horse.image}">`:"🐎"}</div><div class="grow"><b>${p.name}</b><div class="mini">${p.id===room.hostId?"房主":p.isBot?"试玩马":"参赛者"}</div></div><span class="tag ${p.isBot?"bot":""}">${p.isBot?"AI":"READY"}</span></div>`).join("");const host=room.hostId===userId,lobby=room.status==="lobby";$("#startRaceBtn").disabled=!(host&&lobby&&room.players.length>=3);$("#startRaceBtn").textContent=!host?"等待房主开赛":!lobby?"比赛已开始":room.players.length<3?"至少 3 人才能开始":`开始比赛 · ${room.players.length}匹马`;$("#addBotBtn").style.display=host&&lobby?"block":"none";$("#betOpenBtn").disabled=!lobby}
socket.on("room:update",next=>{if(room&&next.code===room.code){room=next;renderRoom()}});
function roomInviteUrl(){return room?`${location.origin}/r/${room.code}`:location.href}
function isWeChat(){return /MicroMessenger/i.test(navigator.userAgent)}
async function copyText(text){
  try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);return true}}catch{}
  const ta=document.createElement("textarea");ta.value=text;ta.setAttribute("readonly","");ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();ta.setSelectionRange(0,ta.value.length);let ok=false;try{ok=document.execCommand("copy")}catch{}ta.remove();return ok
}
function closeInvitePanel(){$("#inviteModal").classList.remove("open");$("#inviteModal").setAttribute("aria-hidden","true")}
function openInvitePanel(){
  if(!room)return toast("请先进入房间");
  const url=roomInviteUrl();
  $("#inviteRoomNo").textContent=`房间 #${room.code}`;
  $("#inviteLink").value=url;
  $("#roomQr").src=`/api/rooms/${encodeURIComponent(room.code)}/qr.svg?v=${Date.now()}`;
  $("#roomQr").onerror=()=>toast("二维码生成失败，可先复制房间链接");
  $("#inviteModal").classList.add("open");$("#inviteModal").setAttribute("aria-hidden","false");
}
async function systemShareRoom(){
  if(!room)return;
  const url=roomInviteUrl(),data={title:"Draw a Horse · Then Race It",text:`我在房间 #${room.code} 等你，画匹马来比赛！`,url};
  if(navigator.share){try{await navigator.share(data);return}catch(error){if(error?.name==="AbortError")return}}
  const ok=await copyText(`${data.text} ${url}`);toast(ok?"邀请链接已复制，可发到微信":"请长按复制邀请链接")
}
$("#shareBtn").onclick=openInvitePanel;
$("#qrBtn").onclick=openInvitePanel;
$("#inviteCloseBtn").onclick=closeInvitePanel;
document.querySelectorAll("[data-invite-close]").forEach(el=>el.onclick=closeInvitePanel);
$("#copyLinkBtn").onclick=async()=>{const ok=await copyText(roomInviteUrl());toast(ok?"房间链接已复制":"请长按复制链接")};
$("#systemShareBtn").onclick=systemShareRoom;
$("#wechatShareBtn").onclick=async()=>{
  if(isWeChat()){closeInvitePanel();$("#wechatGuide").classList.add("open");$("#wechatGuide").setAttribute("aria-hidden","false");return}
  await systemShareRoom();
};
$("#wechatGuideClose").onclick=()=>{$("#wechatGuide").classList.remove("open");$("#wechatGuide").setAttribute("aria-hidden","true")};
$("#addBotBtn").onclick=()=>socket.emit("room:add-bot",{code:room.code,userId},res=>{if(!res.ok)toast(res.message)});
$("#leaveRoomBtn").onclick=()=>{if(room)socket.emit("room:leave",{code:room.code,userId});room=null;history.replaceState(null,"",location.pathname);go("home")};
$("#openRoomsBtn").onclick=async()=>{const rooms=await fetch("/api/rooms").then(r=>r.json());$("#roomList").innerHTML=rooms.length?rooms.map(r=>`<div class="room-card"><b>房间 #${r.code}</b><div class="room-meta"><span>${r.players.length}/8 人</span><span>${r.players[0]?.name||"等待玩家"}</span></div><button class="btn secondary join-public" data-code="${r.code}">加入</button></div>`).join(""):`<div class="empty">目前没有公开等待中的房间。你可以创建一个。</div>`;document.querySelectorAll(".join-public").forEach(b=>b.onclick=()=>joinRoom(b.dataset.code));go("rooms")};

$("#betOpenBtn").onclick=()=>{if(!room||room.status!=="lobby")return toast("当前不能竞猜");selectedBetTarget=null;$("#betList").innerHTML=room.players.map(p=>`<div class="bet-option" data-id="${p.id}"><div class="avatar">${p.horse?.image?`<img src="${p.horse.image}">`:"🐎"}</div><div class="grow"><b>${p.name}</b><div class="mini">命中后返还 ×2</div></div></div>`).join("");document.querySelectorAll(".bet-option").forEach(el=>el.onclick=()=>{document.querySelectorAll(".bet-option").forEach(x=>x.classList.remove("active"));el.classList.add("active");selectedBetTarget=el.dataset.id});go("bet")};
$("#confirmBetBtn").onclick=()=>{if(!selectedBetTarget)return toast("请选择一匹马");socket.emit("bet:place",{code:room.code,userId,targetId:selectedBetTarget,amount:Number($("#betAmount").value||20)},res=>{if(!res.ok)return toast(res.message);points=res.points;$("#points").textContent=points;toast("竞猜成功");go("room")})};
$("#startRaceBtn").onclick=()=>socket.emit("race:start",{code:room.code,userId},res=>{if(!res.ok)toast(res.message)});
socket.on("race:plan",payload=>{if(room&&payload.players.some(p=>p.id===userId))playRace(payload)});
function makeTrack(players){const track=$("#track");track.querySelectorAll(".runner,.lane-line").forEach(x=>x.remove());const top=29,usable=64;players.forEach((p,i)=>{const y=top+i*(usable/Math.max(1,players.length));const line=document.createElement("div");line.className="lane-line";line.style.top=`${y+7}%`;track.appendChild(line);const runner=document.createElement("div");runner.className="runner";runner.dataset.playerId=p.id;runner.style.top=`${y}%`;runner.innerHTML=`<span class="runner-name">${p.name}</span>${p.horse?.image?`<img src="${p.horse.image}">`:`<span class="emoji">🐎</span>`}`;track.appendChild(runner)})}
function playRace({race,players}){cancelAnimationFrame(raceAnimation);go("race");makeTrack(players);const runners=players.map(p=>document.querySelector(`.runner[data-player-id="${p.id}"]`));const countdown=$("#countdown"),startAt=race.startedAt;let eventIndex=0;const maxX=()=>$("#track").clientWidth-115;function render(nowPerf){const serverElapsed=Date.now()-startAt;if(serverElapsed<0){const sec=Math.max(1,Math.ceil(-serverElapsed/1000));countdown.textContent=sec;$("#commentary").textContent="闸门已经关闭，准备起跑……";raceAnimation=requestAnimationFrame(render);return}countdown.textContent=serverElapsed<650?"GO!":"";const elapsed=Math.min(race.durationMs,Math.max(0,serverElapsed));const idx=Math.min(race.frames.length-2,Math.floor(elapsed/race.stepMs)),a=race.frames[idx],b=race.frames[idx+1]||a,local=Math.max(0,Math.min(1,(elapsed-a.timeMs)/Math.max(1,b.timeMs-a.timeMs))),positions=a.positions.map((v,i)=>v+(b.positions[i]-v)*local);positions.forEach((v,i)=>{if(runners[i])runners[i].style.transform=`translateX(${v*maxX()}px)`});const li=positions.indexOf(Math.max(...positions));$("#leaderText").textContent=`领先：${players[li]?.name||"-"}`;$("#raceClock").textContent=`${(elapsed/1000).toFixed(1)}s / ${(race.durationMs/1000).toFixed(0)}s`;$("#raceProgress").style.width=`${elapsed/race.durationMs*100}%`;while(eventIndex<race.events.length&&elapsed>=race.events[eventIndex].timeMs){$("#commentary").textContent=race.events[eventIndex].text;eventIndex++}if(elapsed<race.durationMs)raceAnimation=requestAnimationFrame(render)}raceAnimation=requestAnimationFrame(render)}

socket.on("race:finish",async({results,betResults})=>{lastResults=results;lastBetResult=betResults?.[userId]||null;await loadUser();$("#results").innerHTML=results.map(r=>`<div class="result-row"><b style="width:30px">${["🥇","🥈","🥉"][r.rank-1]||r.rank}</b><div class="grow"><b>${r.name}</b><div class="mini">${(r.timeMs/1000).toFixed(2)} 秒</div></div></div>`).join("");$("#betResult").innerHTML=!lastBetResult?"本场未参与积分竞猜。":lastBetResult.won?`🎉 竞猜命中，返还 <b>${lastBetResult.payout}</b> 积分。`:"本场竞猜未命中。";setTimeout(()=>go("result"),650)});
$("#rematchBtn").onclick=()=>{if(!room)return go("home");if(room.hostId!==userId)return go("room");socket.emit("room:reset",{code:room.code,userId},res=>{if(!res.ok)return toast(res.message);room=res.room;renderRoom();go("room")})};
$("#shareResultBtn").onclick=async()=>{if(!lastResults)return;const champion=lastResults[0]?.name||"冠军";const text=`刚刚的 Draw a Horse 比赛冠军是「${champion}」！我也画了一匹马来跑。`;const url=room?roomInviteUrl():location.href;if(isWeChat()){$("#wechatGuide").classList.add("open");$("#wechatGuide").setAttribute("aria-hidden","false");return}if(navigator.share){try{await navigator.share({title:"Draw a Horse",text,url});return}catch(error){if(error?.name==="AbortError")return}}const ok=await copyText(`${text} ${url}`);toast(ok?"战绩文案已复制":"请长按复制分享链接")};

async function loadLeaderboard(){const list=await fetch("/api/leaderboard").then(r=>r.json());$("#leaderboardList").innerHTML=list.length?list.map((u,i)=>`<div class="result-row"><b style="width:30px">${["🥇","🥈","🥉"][i]||i+1}</b><div class="grow"><b>${u.name}</b><div class="mini">冠军 ${u.stats.wins} · 领奖台 ${u.stats.podiums} · 参赛 ${u.stats.races}</div></div></div>`).join(""):`<div class="empty">还没有比赛记录。</div>`}
async function loadShop(){const c=await fetch("/api/payment/config").then(r=>r.json());$("#shopList").innerHTML=c.shop.map(s=>`<div class="room-card"><b>${s.name}</b><div class="room-meta"><span>虚拟商品</span><span class="shop-price">¥${s.amount}</span></div><button class="btn secondary buy-sku" data-sku="${s.skuId}">${c.enabled?"购买":"支付未启用"}</button></div>`).join("");document.querySelectorAll(".buy-sku").forEach(b=>b.onclick=async()=>{const res=await fetch("/api/payment/create",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({userId,skuId:b.dataset.sku,returnUrl:location.href})});const out=await res.json();if(!out.ok)return toast(out.message);toast("测试支付成功")})}

socket.on("connect",()=>{if(room?.code)joinRoom(room.code)});
if(pendingRoom){$("#joinCode").value=pendingRoom;if(horse)joinRoom(pendingRoom);else{$("#drawHint").textContent=`好友邀请你加入房间 #${pendingRoom}，先画一匹马`;go("draw")}}
