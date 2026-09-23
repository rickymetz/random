// Synthesised sound effects and music (WebAudio) — no asset files. The TV
// unlocks audio on its first click or key press.
//
// Everything goes through two buses, sound effects and music, into a master
// gain: the settings switch each on or off, and tap() hands the master mix
// to a recorder (the preview's sizzle reel).

import { createMusic } from "./music.js";

let ac = null, master = null, fxBus = null, musicBus = null, tune = null;
let mix = { sfx: 1, music: 1 }, want = null; // the song asked for before audio was unlocked
export function unlock() {
  try {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.connect(ac.destination);
      fxBus = ac.createGain(); fxBus.connect(master);
      musicBus = ac.createGain(); musicBus.gain.value = 0.55; musicBus.connect(master);
      tune = createMusic(ac, musicBus);
      setMix(mix);
      if (want) music.play(...want);
    }
    if (ac.state === "suspended") ac.resume();
  } catch { ac = null; }
}

// { sfx: 0..1, music: 0..1 }
export function setMix(m) {
  mix = { ...mix, ...m };
  if (!ac) return;
  fxBus.gain.setTargetAtTime(mix.sfx, ac.currentTime, 0.05);
  musicBus.gain.setTargetAtTime(0.55 * mix.music, ac.currentTime, 0.1);
}

export const music = {
  play(name, seed = "") { want = [name, seed]; tune?.play(name, seed); },
  stop() { want = null; tune?.stop(); },
  duck(on) { tune?.duck(on); },
};

// the master mix as a MediaStream (for recording), or null before unlock
let tapNode = null;
export function tap() {
  if (!ac) return null;
  tapNode ??= ac.createMediaStreamDestination();
  master.connect(tapNode);
  return tapNode.stream;
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
  o.connect(g).connect(fxBus);
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
  s.connect(g).connect(fxBus);
  s.start();
}

export const sfx = {
  whoosh: () => { noise(0.25, 0.08); tone(300, 0.25, { type: "sawtooth", slide: 900, vol: 0.03 }); },
  slam: () => { tone(90, 0.3, { type: "square", slide: -50, vol: 0.12 }); noise(0.15, 0.2); },
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
