// Synthesised sound effects and music (WebAudio) — no asset files. The TV
// unlocks audio on its first click or key press.
//
// Everything goes through two buses, sound effects and music, into a master
// gain and then a limiter (so eight players all flapping can't clip): the settings switch each bus on or off, and tap() hands the master
// mix to a recorder (the preview's sizzle reel). Each effect has a voice cap,
// and repeats get a hair of random timing and pitch so a crowd of identical
// sounds doesn't stack into one loud phasey one. Key cues dip the music.

import { createMusic, masterChain } from "./music.js";

const MUSIC_LEVEL = 0.5;
let ac = null, master = null, fxBus = null, musicBus = null, tune = null;
let mix = { sfx: 1, music: 1 }, want = null; // the song asked for before audio was unlocked
export function unlock() {
  try {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.connect(masterChain(ac, ac.destination));
      fxBus = ac.createGain(); fxBus.connect(master);
      musicBus = ac.createGain(); musicBus.gain.value = MUSIC_LEVEL; musicBus.connect(master);
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
  musicBus.gain.setTargetAtTime(MUSIC_LEVEL * mix.music, ac.currentTime, 0.1);
}

export const music = {
  play(name, seed = "", kind = "") { want = [name, seed, kind]; tune?.play(name, seed, kind); },
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
  const t = ac.currentTime + delay + jitter.t;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.detune.value = jitter.cents;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.003); // a 3 ms attack: no click
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(voice || fxBus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise(dur, vol = 0.15) {
  if (!ac) return;
  if (!noiseBuf) { // made once, played from a random point
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ac.currentTime + jitter.t;
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = noiseBuf;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.002, dur / 3); // a natural decay: noise keeps its body
  s.connect(g).connect(voice || fxBus);
  s.start(t, Math.random() * (2 - dur));
  s.stop(t + dur + 0.02);
}

// Voice caps: at most `max` of one effect per 120 ms; the 2nd and later in a
// burst get a little random delay and detune, so they don't phase-stack.
// Effects in a group share one voice and the newest wins (win and lose: the
// later call is the verdict). Timed on the wall clock, which keeps going even
// if the audio is interrupted.
const jitter = { t: 0, cents: 0 };
const recent = {}, owned = {};
let voice = null; // while a grouped effect plays, its notes go through this gain
function voiced(name, fn, { max = 3, dip = 0, depth = 0.5, group = null } = {}) {
  return (...a) => {
    if (!ac) return;
    const now = performance.now();
    if (group) { // steal: fade whatever this group is still playing
      owned[group]?.gain.setTargetAtTime(0, ac.currentTime, 0.01);
      voice = ac.createGain(); voice.connect(fxBus);
      fn(...a); owned[group] = voice; voice = null;
    } else {
      const list = (recent[name] = (recent[name] || []).filter((t) => now - t < 120));
      if (list.length >= max) return;
      list.push(now);
      const extra = list.length > 1;
      jitter.t = extra ? Math.random() * 0.012 : 0;
      jitter.cents = extra ? (Math.random() * 2 - 1) * 15 : 0;
      fn(...a);
      jitter.t = 0; jitter.cents = 0;
    }
    if (dip) tune?.dip(dip, depth);
  };
}

const RAW = {
  whoosh: () => { noise(0.25, 0.08); tone(300, 0.25, { type: "sawtooth", slide: 900, vol: 0.03 }); },
  slam: () => { tone(90, 0.3, { type: "square", slide: -50, vol: 0.12 }); tone(180, 0.22, { type: "square", slide: -90, vol: 0.06 }); noise(0.15, 0.2); }, // the 180 Hz layer reads on TV speakers
  join: () => { tone(523, 0.1, { type: "triangle" }); tone(784, 0.14, { type: "triangle", delay: 0.08 }); },
  flap: () => tone(380, 0.08, { type: "triangle", slide: 260, vol: 0.14 }),
  hit: () => { noise(0.18, 0.2); tone(180, 0.25, { type: "sawtooth", slide: -120, vol: 0.06 }); },
  pop: () => { tone(900, 0.07, { slide: 600, vol: 0.06 }); noise(0.08, 0.1); },
  crunch: () => noise(0.12, 0.14),
  launch: () => tone(200, 0.3, { type: "sawtooth", slide: 500, vol: 0.1 }),
  dot: () => tone(1320, 0.05, { vol: 0.08 }), // above the arp's register
  power: () => [0, 0.07, 0.14].forEach((d, i) => tone(440 * (1 + i * 0.5), 0.1, { type: "triangle", delay: d })),
  tick: () => tone(1000, 0.05, { type: "sine", vol: 0.09 }),
  go: () => tone(880, 0.3, { type: "square", vol: 0.085 }),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: "triangle", delay: i * 0.1, vol: 0.11 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.2, { type: "triangle", delay: i * 0.12, vol: 0.085 })),
};

// the jingles and GO dip the music so they cut through; busy ones are capped harder
// (slam and hit already sit well above the music; the jingles and GO need the room)
const CUES = { slam: { max: 1 }, win: { group: "stinger", dip: 650 }, lose: { group: "stinger", dip: 650 }, go: { dip: 350, max: 1 }, power: { max: 2 }, dot: { max: 2 }, crunch: { max: 2 }, flap: { max: 2 } };
export const sfx = Object.fromEntries(Object.entries(RAW).map(([k, fn]) => [k, voiced(k, fn, CUES[k])]));
