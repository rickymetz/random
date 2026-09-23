// Synthesised sound effects (WebAudio) — no asset files. The TV unlocks audio
// on its first click or key press.

let ac = null;
export function unlock() {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
  } catch { ac = null; }
}

function tone(freq, dur, { type = "square", vol = 0.08, slide = 0, delay = 0 } = {}) {
  if (!ac) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.15) {
  if (!ac) return;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = buf; g.gain.value = vol;
  s.connect(g).connect(ac.destination);
  s.start();
}

export const sfx = {
  join: () => { tone(523, 0.1, { type: "triangle" }); tone(784, 0.14, { type: "triangle", delay: 0.08 }); },
  flap: () => tone(380, 0.08, { type: "triangle", slide: 260, vol: 0.05 }),
  hit: () => { noise(0.18, 0.2); tone(180, 0.25, { type: "sawtooth", slide: -120, vol: 0.06 }); },
  pop: () => { tone(900, 0.07, { slide: 600, vol: 0.06 }); noise(0.08, 0.1); },
  crunch: () => noise(0.12, 0.14),
  launch: () => tone(200, 0.3, { type: "sawtooth", slide: 500, vol: 0.05 }),
  dot: () => tone(660, 0.04, { vol: 0.025 }),
  power: () => [0, 0.07, 0.14].forEach((d, i) => tone(440 * (1 + i * 0.5), 0.1, { type: "triangle", delay: d })),
  tick: () => tone(1000, 0.04, { type: "sine", vol: 0.05 }),
  go: () => tone(880, 0.3, { type: "square", vol: 0.06 }),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: "triangle", delay: i * 0.1, vol: 0.08 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.2, { type: "triangle", delay: i * 0.12, vol: 0.06 })),
};
