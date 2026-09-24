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
  tune?.enable(mix.music > 0); // music off: don't keep synthesising it at zero volume
}

export const music = {
  play(name, seed = "", kind = "") { want = [name, seed, kind]; tune?.play(name, seed, kind); },
  stop() { want = null; tune?.stop(); },
  duck(on) { tune?.duck(on); },
  // the game drives its song: see music.js
  pause(on) { tune?.pause(on); },
  countdown(secs) { tune?.countdown(secs); },
  go() { tune?.go(); },
  half() { tune?.half(); },
  hot(on) { tune?.hot(on); },
  speed(level) { tune?.speed(level); },
  outro() { tune?.outro(); },
  dip(ms, depth) { tune?.dip(ms, depth); },
  get state() { return tune?.state; },
};

// the master mix as a MediaStream (for recording), or null before unlock
let tapNode = null;
export function tap() {
  if (!ac) return null;
  tapNode ??= ac.createMediaStreamDestination();
  master.connect(tapNode);
  return tapNode.stream;
}

// chip voices, like the music: pulse waves at a few duty cycles, stepped noise
const pulses = {};
function pulse(duty) {
  if (pulses[duty]) return pulses[duty];
  const n = 48, real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return (pulses[duty] = ac.createPeriodicWave(real, imag));
}
// The key: pitched effects play in the current song's scale (the last one
// heard, when nothing's playing), so they never clash with the music.
let lastKey = { root: 60, scale: [0, 2, 4, 5, 7, 9, 11] }, forcedKey = null;
// pin the key (the sizzle recorder plays its own song, not the game's)
export function setKey(k) { forcedKey = k?.scale ? k : null; }
function keyOf() {
  const k = forcedKey || tune?.key;
  if (k?.scale) lastKey = k;
  return { tonic: 60 + (((lastKey.root - 60) % 12) + 12) % 12, sc: lastKey.scale };
}
const mhz = (m) => 440 * 2 ** ((m - 69) / 12);
// scale degree d of the current song (0 = the tonic around C4-B4, 7 = an octave up)
function scaleNote(d) {
  const { tonic, sc } = keyOf();
  return mhz(tonic + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7));
}

// Where a sound comes from: its player's side of the screen (pan, level-
// compensated so a panned sound is as loud as a centred one) and that
// player's pitch, a step of the song's scale: chord tones for the first
// four seats. Tonal effects take the whole step; noisy / sliding ones only
// a little of it, so nobody's hits sound heavier than anyone else's.
const PALETTE = ["#ff2e63", "#00b7ff", "#ffd400", "#35e06b", "#b14dff", "#ff8a00", "#ff6ec7", "#00e0c6"];
const SEAT_DEG = [0, 2, 4, -3, 5, 1, 7, -1];
const NONE = { pan: 0, panned: false, amp: 1, deg: 0, cents: 0, seat: -1 };
let place = NONE;
function placeOf(at, mode) {
  if (!at || typeof at !== "object") return NONE;
  const x = at.x, p = at.p || (at.color ? at : null), seat = p ? PALETTE.indexOf(p.color) : -1;
  const panned = typeof x === "number", deg = seat >= 0 && mode ? SEAT_DEG[seat] : 0;
  const narrow = Math.max(-2, Math.min(2, deg)); // hits and slides: at most two steps
  return {
    pan: panned ? Math.max(-1, Math.min(1, (x / 1920) * 2 - 1)) * 0.5 : 0, panned, amp: panned ? Math.SQRT2 : 1, seat,
    deg: mode === "tonal" ? deg : 0,
    cents: mode === "narrow" && narrow ? 1200 * Math.log2(scaleNote(narrow) / scaleNote(0)) : 0,
  };
}
function out(g) { // through a panner when the sound has a side
  if (!place.panned) return g.connect(voice || fxBus);
  const pn = ac.createStereoPanner(); pn.pan.value = place.pan;
  return g.connect(pn).connect(voice || fxBus);
}

function tone(freq, dur, { type = "square", vol = 0.08, slide = 0, delay = 0, to = null } = {}) {
  if (!ac) return;
  const t = ac.currentTime + delay + jitter.t;
  const o = ac.createOscillator(), g = ac.createGain();
  if (typeof type === "number") o.setPeriodicWave(pulse(type)); else o.type = type;
  o.detune.value = jitter.cents + place.cents;
  o.frequency.setValueAtTime(freq, t);
  if (slide || to) o.frequency.exponentialRampToValueAtTime(Math.max(30, to ?? freq + slide), t + dur);
  g.gain.value = 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * place.amp, t + 0.003); // a 3 ms attack: no click
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); out(g);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise(dur, vol = 0.15, { lowpass = 0, highpass = 0, delay = 0, sweep = 0 } = {}) {
  if (!ac) return;
  if (!noiseBuf) { // made once, played from a random point: stepped, like a chip's noise channel
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < d.length; i++) { if (i % 2 === 0) v = Math.random() * 2 - 1; d[i] = v; }
  }
  const t = ac.currentTime + jitter.t + delay;
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = noiseBuf; s.playbackRate.value = 2 ** (place.cents / 1200);
  g.gain.value = 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * place.amp, t + (sweep ? dur * 0.9 : 0.002));
  if (sweep) g.gain.linearRampToValueAtTime(0, t + dur);
  else g.gain.setTargetAtTime(0, t + 0.002, dur / 3); // a natural decay: noise keeps its body
  let head = s;
  if (lowpass || highpass) {
    const f = ac.createBiquadFilter(); f.type = lowpass ? "lowpass" : "highpass"; f.frequency.value = lowpass || highpass;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    head = s.connect(f);
  }
  head.connect(g); out(g);
  s.start(t, Math.random() * Math.max(0, 2 - dur * s.playbackRate.value - 0.05));
  s.stop(t + dur + 0.02);
}

// Voice caps: at most `max` of one effect per 120 ms (for effects from
// players, one per player and four in all, so a burst doesn't just play the
// first seats); the 2nd and later in a burst get a little random delay and
// detune, so they don't phase-stack. Effects in a group share one voice and
// the newest wins (win and lose: the later call is the verdict). Timed on
// the wall clock, which keeps going even if the audio is interrupted.
const jitter = { t: 0, cents: 0 };
const recent = {}, owned = {};
let voice = null; // while a grouped effect plays, its notes go through this gain
let buzzAt = -1e9, verdictAt = -1e9;
function voiced(name, fn, { max = 3, dip = 0, depth = 0.5, group = null, seat = false } = {}) {
  return (...a) => {
    if (!ac) return;
    const now = performance.now();
    if ((name === "final" || name === "buzzer") && now - verdictAt < 2500) return; // the game's already decided
    place = placeOf(a[0], seat);
    if (group) { // steal: fade whatever this group is still playing
      if (name === "win" || name === "lose") verdictAt = now;
      owned[group]?.gain.setTargetAtTime(0, ac.currentTime, 0.01);
      voice = ac.createGain(); voice.connect(fxBus);
      jitter.t = now - buzzAt < 400 ? 0.45 : 0; // after the buzzer, not on top of it
      fn(...a); owned[group] = voice; voice = null; jitter.t = 0;
    } else {
      const list = (recent[name] = (recent[name] || []).filter((r) => now - r.t < 120));
      if (list.length >= (place.seat >= 0 ? 4 : max) || (place.seat >= 0 && list.some((r) => r.seat === place.seat))) { place = NONE; return; }
      list.push({ t: now, seat: place.seat });
      const extra = list.length > 1;
      jitter.t = extra ? Math.random() * 0.012 : 0;
      jitter.cents = extra ? (Math.random() * 2 - 1) * 15 : 0;
      fn(...a);
      jitter.t = 0; jitter.cents = 0;
    }
    if (name === "buzzer") buzzAt = now;
    if (dip) tune?.dip(dip, depth);
    place = NONE;
  };
}

// a note st semitones over the song's tonic, around C4-B4 (C major before any song)
function jingleHz(st) { return mhz(keyOf().tonic + st); }
const P = () => place.deg; // the player's step, for tonal effects

// Every effect can take where it came from: a body (with .x and .p) or a
// player, for its side of the screen and that player's pitch.
const RAW = {
  whoosh: () => { noise(0.25, 0.08, { highpass: 600 }); tone(300, 0.25, { type: 0.25, slide: 900, vol: 0.03 }); },
  slam: () => { tone(90, 0.3, { type: 0.5, slide: -50, vol: 0.12 }); tone(180, 0.22, { type: 0.5, slide: -90, vol: 0.06 }); noise(0.15, 0.2, { lowpass: 1600 }); }, // the 180 Hz layer reads on TV speakers
  join: () => { tone(scaleNote(0 + P()), 0.1, { type: "triangle" }); tone(scaleNote(4 + P()), 0.14, { type: "triangle", delay: 0.08 }); },
  flap: () => tone(380, 0.08, { type: "triangle", slide: 260, vol: 0.14 }),
  hit: () => { noise(0.18, 0.2, { lowpass: 1200 }); tone(180, 0.2, { type: 0.25, slide: -120, vol: 0.08 }); }, // under the hats, with a pitched body
  pop: () => { tone(900, 0.07, { type: 0.125, slide: 600, vol: 0.07 }); noise(0.08, 0.08, { highpass: 2000 }); },
  crunch: () => { noise(0.12, 0.16, { lowpass: 1400 }); tone(120, 0.1, { type: 0.25, slide: -60, vol: 0.05 }); },
  launch: () => tone(200, 0.3, { type: 0.25, slide: 500, vol: 0.15 }),
  dot: () => tone(scaleNote(11 + P()), 0.09, { type: 0.25, vol: 0.24 }), // the 5th an octave up: above the arp
  power: () => [0, 4, 7].forEach((d, i) => tone(scaleNote(d + P()), 0.1, { type: "triangle", delay: i * 0.07 })),
  tick: () => tone(scaleNote(4), 0.07, { type: "triangle", vol: 0.12 }), // the 5th, resolving to GO's tonic
  go: () => tone(scaleNote(7), 0.3, { type: 0.5, vol: 0.085 }),
  // the jingles play in the song's key (a major arpeggio up for a win, a minor one down for a loss)
  win: () => [0, 4, 7, 12].forEach((st, i) => tone(jingleHz(st), 0.18, { type: "triangle", delay: i * 0.1, vol: 0.11 })),
  lose: () => [7, 3, 0].forEach((st, i) => tone(jingleHz(st), 0.2, { type: "triangle", delay: i * 0.12, vol: 0.085 })),
  // knocked out: a falling chip glide and a burst, in that player's pitch
  ko: () => { tone(800, 0.35, { type: 0.25, to: 100, vol: 0.1 }); noise(0.2, 0.12, { lowpass: 2500 }); },
  // the last seconds: ticks climbing the scale a step a second (up to the octave), and a buzzer at zero
  final: (n = 5) => tone(scaleNote(13 - Math.min(5, n)), 0.14, { type: 0.5, vol: 0.2 }),
  buzzer: () => { const f = scaleNote(-7); tone(f, 0.3, { type: 0.5, vol: 0.07 }); tone(f * 2 ** (1 / 12), 0.3, { type: 0.5, vol: 0.06 }); noise(0.25, 0.08, { lowpass: 900 }); }, // the tonic and its b2
  // small social sounds: READY, a reaction, a row of the results tally, a new leader
  ready: () => tone(scaleNote(4 + P()), 0.09, { type: "triangle", vol: 0.12 }),
  react: () => tone(scaleNote(9 + P()), 0.1, { type: 0.25, slide: 300, vol: 0.2 }),
  tally: (i = 0) => tone(scaleNote(4 + Math.min(i, 8)), 0.12, { type: 0.25, vol: 0.2 }), // up the scale from the 5th
  lead: () => [7, 9, 11, 14].forEach((d, i) => tone(scaleNote(d), 0.1, { type: 0.25, delay: i * 0.06, vol: 0.1 })), // the song's own triad
  // the board: a dice roulette that slows to a thunk as the die stops, a star fanfare, a duel's riser and slam
  dice: () => { let d = 0; for (let k = 0; k < 11; k++) { tone(1400 - k * 40, 0.045, { type: 0.25, delay: d, vol: 0.1 }); d += 0.024 + k * 0.0095; } tone(150, 0.15, { type: 0.5, slide: -60, delay: d, vol: 0.12 }); },
  star: () => { [0, 4, 7, 12, 16].forEach((st, i) => tone(jingleHz(st), 0.14, { type: 0.25, delay: i * 0.08, vol: 0.09 })); tone(jingleHz(24), 0.6, { type: 0.125, delay: 0.42, vol: 0.07 }); },
  duel: () => { noise(0.6, 0.1, { highpass: 400, sweep: 5000 }); tone(90, 0.3, { type: 0.5, slide: -50, vol: 0.12, delay: 0.6 }); noise(0.15, 0.2, { lowpass: 1600, delay: 0.6 }); },
};

// the jingles dip the music so they cut through; busy ones are capped harder
// (slam and hit already sit well above the music; GO lands on the music's drop, which carries it)
// seat: "tonal" (the player's whole scale step) or "narrow" (at most two steps, for hits and slides)
const CUES = {
  slam: { max: 1, seat: "narrow" }, win: { group: "stinger", dip: 650 }, lose: { group: "stinger", dip: 650 }, go: { max: 1 },
  power: { max: 2, seat: "tonal" }, dot: { max: 2, seat: "tonal" }, join: { seat: "tonal" }, ready: { seat: "tonal" }, react: { max: 2, seat: "tonal" },
  hit: { seat: "narrow" }, crunch: { max: 2, seat: "narrow" }, pop: { seat: "narrow" }, flap: { max: 2, seat: "narrow" }, launch: { seat: "narrow" },
  ko: { max: 3, seat: "narrow" }, whoosh: { seat: "narrow" },
  final: { max: 1 }, buzzer: { max: 1, dip: 500 }, tally: { max: 2 }, lead: { max: 1, dip: 400 },
  dice: { max: 1 }, star: { group: "stinger", dip: 900 }, duel: { max: 1, dip: 800 },
};
export const sfx = Object.fromEntries(Object.entries(RAW).map(([k, fn]) => [k, voiced(k, fn, CUES[k])]));
