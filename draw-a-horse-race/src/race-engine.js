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
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function buildRacePlan(players, roomCode) {
  const durationMs = 12000;
  const stepMs = 250;
  const steps = Math.floor(durationMs / stepMs) + 1;
  const seed = hashString(`${roomCode}:${Date.now()}:${players.map(p => p.id).join("|")}`);
  const rand = mulberry32(seed);

  const profiles = players.map((player, index) => {
    const stats = player.horse?.stats || {};
    const speed = clamp(Number(stats.speed || 65), 40, 100);
    const stamina = clamp(Number(stats.stamina || 65), 40, 100);
    const burst = clamp(Number(stats.burst || 65), 40, 100);
    const luck = clamp(Number(stats.luck || 65), 40, 100);

    const strength = 0.92 + ((speed + stamina + burst) / 300) * 0.16;
    const lucky = (luck - 50) / 500;
    const startKick = 0.92 + rand() * 0.20;
    const midKick = 0.92 + rand() * 0.20;
    const finalKick = 0.94 + rand() * 0.24;
    const wobblePhase = rand() * Math.PI * 2;

    return {
      player,
      index,
      strength,
      lucky,
      startKick,
      midKick,
      finalKick,
      wobblePhase,
      raw: [0],
      progress: 0
    };
  });

  for (let s = 1; s < steps; s++) {
    const t = s / (steps - 1);
    for (const p of profiles) {
      let phaseFactor = 1;
      if (t < 0.20) phaseFactor = p.startKick;
      else if (t < 0.72) phaseFactor = p.midKick;
      else phaseFactor = p.finalKick;

      const staminaFade = t > 0.68 ? (0.98 + ((p.player.horse?.stats?.stamina || 65) - 65) / 700) : 1;
      const wave = 1 + Math.sin(t * 18 + p.wobblePhase) * 0.035;
      const micro = 0.965 + rand() * 0.075;
      const surprise = rand() < (0.018 + Math.max(0, p.lucky)) ? 1.10 : 1;
      const delta = p.strength * phaseFactor * staminaFade * wave * micro * surprise;

      p.progress += delta;
      p.raw.push(p.progress);
    }
  }

  const finishBiases = profiles.map(p => 0.965 + rand() * 0.07 - p.lucky * 0.12);
  const frames = [];
  for (let s = 0; s < steps; s++) {
    const timeMs = s * stepMs;
    const t = timeMs / durationMs;
    const positions = profiles.map((p, i) => {
      const rawMax = p.raw[p.raw.length - 1];
      let normalized = p.raw[s] / rawMax;
      normalized = normalized / finishBiases[i];
      normalized = clamp(normalized, 0, 1);
      if (t < 0.08) normalized *= (0.45 + t / 0.08 * 0.55);
      return Number(normalized.toFixed(5));
    });
    frames.push({ timeMs, positions });
  }

  for (let i = Math.max(0, frames.length - 4); i < frames.length; i++) {
    const alpha = (i - (frames.length - 4) + 1) / 4;
    frames[i].positions = frames[i].positions.map(v => Number((v + (1 - v) * alpha).toFixed(5)));
  }
  frames[frames.length - 1].positions = frames[frames.length - 1].positions.map(() => 1);

  const finishTimes = profiles.map((p, playerIndex) => {
    const hit = frames.find(f => f.positions[playerIndex] >= 0.995);
    return hit?.timeMs ?? durationMs;
  });
  const order = profiles
    .map((p, i) => ({ playerId: p.player.id, index: i, timeMs: finishTimes[i] }))
    .sort((a, b) => a.timeMs - b.timeMs || a.index - b.index);

  const eventTimes = [2500, 5000, 7600, 9800];
  const events = eventTimes.map((timeMs, eventIndex) => {
    const frame = frames.reduce((best, f) => Math.abs(f.timeMs - timeMs) < Math.abs(best.timeMs - timeMs) ? f : best, frames[0]);
    const leaderIndex = frame.positions.indexOf(Math.max(...frame.positions));
    const leader = players[leaderIndex];
    const texts = [
      `${leader.name} 抢到了领先位置！`,
      `${leader.name} 正在中段加速！`,
      `${leader.name} 冲到前面，比赛开始胶着！`,
      `${leader.name} 进入最后冲刺！`
    ];
    return { timeMs, text: texts[eventIndex] };
  });

  return {
    id: `race_${Date.now()}`,
    seed,
    durationMs,
    stepMs,
    frames,
    order,
    events,
    startedAt: Date.now() + 3200
  };
}
