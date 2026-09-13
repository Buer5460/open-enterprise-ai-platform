const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(input = "") {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function buildRacePlan(players, roomCode, now = Date.now()) {
  const durationMs = 12000;
  const stepMs = 200;
  const steps = Math.floor(durationMs / stepMs) + 1;
  const seed = hashString(`${roomCode}:${now}:${players.map(p => p.id).join("|")}`);
  const rand = mulberry32(seed);

  const profiles = players.map((player, index) => {
    const stats = player.horse?.stats || {};
    const speed = clamp(Number(stats.speed || 65), 40, 100);
    const stamina = clamp(Number(stats.stamina || 65), 40, 100);
    const burst = clamp(Number(stats.burst || 65), 40, 100);
    const luck = clamp(Number(stats.luck || 65), 40, 100);
    return {
      player, index, speed, stamina, burst, luck,
      startKick: 0.90 + rand() * 0.22 + (burst - 65) / 800,
      cruise: 0.92 + rand() * 0.18 + (speed - 65) / 900,
      finishKick: 0.94 + rand() * 0.18 + (burst - 65) / 700,
      phase: rand() * Math.PI * 2,
      raw: [0], progress: 0
    };
  });

  for (let s = 1; s < steps; s++) {
    const t = s / (steps - 1);
    for (const p of profiles) {
      let phaseFactor = t < .18 ? p.startKick : t < .72 ? p.cruise : p.finishKick;
      const staminaFactor = t > .58 ? 0.96 + (p.stamina - 50) / 1000 : 1;
      const wave = 1 + Math.sin(t * 22 + p.phase) * 0.045;
      const micro = 0.94 + rand() * 0.12;
      const luckChance = 0.012 + Math.max(0, p.luck - 65) / 2500;
      const luckyBurst = rand() < luckChance ? (1.08 + rand() * 0.08) : 1;
      const stumble = rand() < 0.008 ? 0.88 : 1;
      const ability = 0.96 + (p.speed - 65) / 900;
      const delta = phaseFactor * staminaFactor * wave * micro * luckyBurst * stumble * ability;
      p.progress += delta;
      p.raw.push(p.progress);
    }
  }

  const finishBias = profiles.map(p => 0.965 + rand() * .07 - (p.luck - 65) / 3000);
  const frames = [];
  for (let s = 0; s < steps; s++) {
    const timeMs = s * stepMs;
    const positions = profiles.map((p, i) => {
      let v = (p.raw[s] / p.raw[p.raw.length - 1]) / finishBias[i];
      v = clamp(v, 0, 1);
      if (timeMs < 900) v *= 0.55 + (timeMs / 900) * 0.45;
      return Number(v.toFixed(6));
    });
    frames.push({ timeMs, positions });
  }

  const tailFrames = Math.ceil(1200 / stepMs);
  for (let i = frames.length - tailFrames; i < frames.length; i++) {
    const alpha = (i - (frames.length - tailFrames) + 1) / tailFrames;
    frames[i].positions = frames[i].positions.map(v => Number((v + (1 - v) * alpha).toFixed(6)));
  }
  frames.at(-1).positions = frames.at(-1).positions.map(() => 1);

  const finishTimes = profiles.map((_, playerIndex) => {
    const threshold = .995;
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1].positions[playerIndex];
      const curr = frames[i].positions[playerIndex];
      if (curr >= threshold) {
        const ratio = curr === prev ? 1 : (threshold - prev) / (curr - prev);
        return Math.round(frames[i - 1].timeMs + ratio * stepMs);
      }
    }
    return durationMs;
  });
  const order = profiles.map((p, i) => ({ playerId: p.player.id, index: i, timeMs: finishTimes[i] }))
    .sort((a, b) => a.timeMs - b.timeMs || a.index - b.index);

  const eventTimes = [1800, 3800, 6200, 8500, 10300];
  const events = eventTimes.map((timeMs, eventIndex) => {
    const frame = frames.reduce((best, f) => Math.abs(f.timeMs - timeMs) < Math.abs(best.timeMs - timeMs) ? f : best, frames[0]);
    const leaderIndex = frame.positions.indexOf(Math.max(...frame.positions));
    const leader = players[leaderIndex];
    const messages = [
      `${leader.name} 起跑很快，率先冲了出去！`,
      `${leader.name} 暂时领先，后面的马正在追赶！`,
      `${leader.name} 进入中段领先，但差距还很小！`,
      `${leader.name} 抢到前面，出现明显反超！`,
      `${leader.name} 进入最后冲刺，终点就在前方！`
    ];
    return { timeMs, text: messages[eventIndex] };
  });

  return { id: `race_${now}`, seed, durationMs, stepMs, frames, order, events, startedAt: now + 3500 };
}
