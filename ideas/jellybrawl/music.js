// Synthesised music (WebAudio): chiptune drum & bass. No files.
//
// An 8-bit band on a step sequencer: pulse-wave leads with delayed vibrato
// and echo, chip chord arpeggios (the chord cycled in 32nd triplets, the old
// way of faking polyphony), a pulse bass over a triangle sub, and
// noise-channel drums playing breakbeats (two-steps, and 2-bar Amen / Think
// chops) at drum & bass tempos.
//
// A song is data: a tempo, a mode, chord progressions, drum / bass / lead
// patterns and a FORM, a list of sections (8-bar A and B, a half-time
// breakdown, a snare-roll build...) that loops. Every 4th bar of a groove
// gets a fill and every new section a crash. The lead plays a 4-bar tune
// made from one seeded motif: stated, sequenced up, varied, then answered
// back home. Each game gets its own song from its id, and a mood (tense,
// silly, heroic or think) from a table, else from its kind.
//
//   const m = createMusic(audioContext, outputNode);
//   m.play("game", "sumo", "Free-for-all");  m.duck(true);  m.stop();
//
// The scheduler looks ahead on the AudioContext clock, so a suspended
// context (the sizzle recorder pauses its own) simply stops the music in
// place and it carries on, in time, when the context resumes.

const MODES = {
  minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const pick = (list, h, shift) => list[(h >>> shift) % list.length];
function rng(seed) { let a = seed >>> 0 || 1; return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- patterns
// Drums: x = hit, o = accent (open hat), g = ghost, . = rest. 16 or 32 steps
// (a 32-step pattern spans two bars).
const BEATS = {
  twostep: { kick: "x.........x.....", snare: "....o......go...", hat: "x.xgx.xgx.xgx.xg" },
  skip: { kick: "x.x.......x.....", snare: "....o..g....o..g", hat: "x.x.x.x.x.x.x.xo" },
  rolling: { kick: "x.........xx....", snare: "....o.g.....o.g.", hat: "xgxgxgxgxgxgxgxo" },
  amen: { kick: "x.x.......xx....x.x.......x.....", snare: "....o..g.g..o..g....o..g.g....o.", hat: "x.x.x.x.x.x.x.x.x.x.x.x.x.x.o.x." },
  think: { kick: "x.........x.x...x......x..x.....", snare: "....o..g.go..o.g....o..g..g.o.gg", hat: "xgx.xgx.xgxox.x.xgx.xgx.xgx.xox." },
};
const HALF = { kick: "x.........x.....", snare: "........o.......", hat: "x.x.x.x.x.x.x.xo" }; // half-time: the snare on 3
const BREATH = { kick: "x...............", snare: "........g.....o.", hat: "x...x...x...x..." }; // one kick a bar: the low end empties out
const SPARSE = { kick: "x...............", snare: "................", hat: "..x...x...x...x." }; // hats and a pulse
const FILLS = [
  { kick: "x.........x.....", snare: "....o...o.gooooo", hat: "x.x.x.x.x.x....." },
  { kick: "x.....x...x.x...", snare: "....o..go.o.oooo", hat: "x.x.x.x.x......." },
  { kick: "x...............", snare: "....o.o.o.o.oooo", hat: "x.x.x.x........." },
];
// Bass: x = root, o = octave, f = fifth, b = flat 7th, s = root with a slide
// up into it, . = rest. Mostly off the kick, so they pump against it.
const BASSES = {
  steady: "x..x..x...x..o..",
  rolling: "xo..xo..x.o.x...",
  synco: "x.x..x.s.xo..x..",
  stab: "...x.o..s.x..fo.",
  walk: "..xo.x.b..x.s.o.",
  bounce: "x..x..f.x..x..o.",
  liquid: "x.......x.....o.",
};
// Lead rhythms, one bar each (x = a note), and the answer bar that ends a phrase
const LEADS = ["x..x..x.x.x.x...", "x.x...x.x...x.xx", "x...x.x...x.x.x.", "xx..x..xx..x.x..", "x..x..x...x.x..."];
const ANSWER = "x..x..x.x.......";

// ------------------------------------------------------------------ forms
// Sections: bars, drums ("main" | "half" | "sparse" | "none" | "build"),
// lead (true | false | "call": the first half of each bar only), arp
// (true | false | "gaps": only where the lead rests), prog ("A" | "B"),
// lift (a fuller pad), open (open hats on the off-beats), low (a breakdown:
// the bass eased, no pad). A form
// plays through once, then loops from section `loop` (default 0).
const FORMS = {
  game: { loop: 0, secs: [
    { name: "A", bars: 8, drums: "main", lead: true, arp: true, prog: "A" },
    { name: "B", bars: 8, drums: "main", lead: true, arp: "gaps", prog: "B", lift: true },
    { name: "break", bars: 4, drums: "half", lead: "call", arp: false, prog: "A", low: true },
    { name: "build", bars: 4, drums: "build", lead: false, arp: true, prog: "B" },
  ] },
  // opens stalking at half-time, then the loop lands the build on full drums
  tense: { loop: 1, secs: [
    { bars: 8, drums: "half", lead: "call", arp: true, prog: "A" },
    { name: "B", bars: 8, drums: "main", lead: true, arp: "gaps", prog: "B", lift: true },
    { name: "break", bars: 4, drums: "sparse", lead: false, arp: true, prog: "A", low: true },
    { name: "build", bars: 4, drums: "build", lead: false, arp: true, prog: "B" },
    { name: "A", bars: 8, drums: "main", lead: "call", arp: true, prog: "A" },
  ] },
  // people talking and concentrating: no lead, barely any drums
  think: { loop: 0, secs: [
    { bars: 8, drums: "sparse", lead: false, arp: true, prog: "A" },
    { bars: 8, drums: "none", lead: false, arp: true, prog: "B" },
  ] },
  lobby: { loop: 0, secs: [
    { bars: 8, drums: "half", lead: false, arp: true, prog: "A" },
    { bars: 8, drums: "sparse", lead: false, arp: true, prog: "B" },
    { bars: 8, drums: "sparse", lead: false, arp: false, prog: "A", low: true },
  ] },
  board: { loop: 0, secs: [
    { bars: 8, drums: "half", lead: false, arp: true, prog: "A" },
    { bars: 8, drums: "half", lead: "call", arp: "gaps", prog: "B" },
    { bars: 8, drums: "sparse", lead: false, arp: true, prog: "A" },
  ] },
  // the victory lap once, then something calmer while people decide on a rematch
  final: { loop: 2, secs: [
    { name: "A", bars: 8, drums: "main", lead: true, arp: true, prog: "A" },
    { name: "B", bars: 8, drums: "main", lead: true, arp: "gaps", prog: "B", lift: true },
    { bars: 8, drums: "half", lead: false, arp: true, prog: "A" },
    { bars: 8, drums: "sparse", lead: "call", arp: "gaps", prog: "B" },
  ] },
};

// Chord progressions are scale degrees, or {st, q} for a borrowed chord
// (semitones above the root, "maj" or "min"): the Mario-style bVI-bVII-I.
const BVI = { st: 8, q: "maj" }, BVII = { st: 10, q: "maj" }, E_MAJ = { st: 7, q: "maj" }; // E_MAJ: the major V of a minor key
const MOODS = {
  // 1 vs the rest: dark and stalking, Phrygian, half-time into a Think break
  tense: { mode: "phrygian", bpm: [170, 172], beats: ["think", "twostep"], basses: ["stab", "synco"], progs: [[[0, 1, 0, 6], [5, 1, 0, 0]], [[0, 0, 1, 0], [6, 5, 1, 0]]], arp: "x...x...x.x.x...", arpDuty: 0.25, leadDuty: 0.125, form: "tense" },
  // free-for-all: bright and bouncy, Mixolydian, a skipping beat
  silly: { mode: "mixolydian", bpm: [174, 176], beats: ["skip", "rolling"], basses: ["bounce", "walk"], progs: [[[0, 6, 3, 0], [3, 4, 6, 0]], [[0, 3, 6, 0], [4, 3, 0, 6]]], arp: "x.x.x.x.x.x.x.x.", arpDuty: 0.125, leadDuty: 0.25, form: "game" },
  // teams: heroic, Dorian, the Amen break
  heroic: { mode: "dorian", bpm: [172, 174], beats: ["amen", "twostep"], basses: ["rolling", "synco", "steady"], progs: [[[0, 6, 3, 0], [2, 6, 3, 3]], [[0, 3, 6, 0], [2, 3, 6, 6]], [[0, 2, 6, 3], [3, 6, 0, 0]]], arp: "xxxxxxxxxxxxxxxx", arpDuty: 0.5, leadDuty: 0.25, form: "game" },
  // talking and concentrating (drawing, a talked-through maze, picking doors): pads and arp, no lead
  think: { mode: "dorian", bpm: [170, 170], beats: ["twostep"], basses: ["liquid"], progs: [[[0, 3, 0, 4], [2, 3, 0, 0]]], arp: "x...x...x...x.x.", arpDuty: 0.25, leadDuty: 0.25, form: "think", noLead: true },
};
// games whose feel doesn't match their kind's label
const MOOD_OF = {
  haunted: "tense", maze: "tense", potato: "tense", bombsquad: "tense", snipe: "tense", blackout: "tense", chomp: "tense", duel: "tense",
  whack: "silly", tug: "silly", paint: "silly", stack: "silly", flap: "silly", snake: "silly", bumper: "silly", coinrush: "silly",
  kaiju: "heroic", kraken: "heroic", crown: "heroic", dodgeball: "heroic", soccer: "heroic", relay: "heroic", sling: "heroic", tank: "heroic", hill: "heroic", sumo: "heroic",
  pilot: "think", draw: "think", greed: "think",
};
const moodOf = (id, kind = "") => MOOD_OF[id] || (/vs rest/i.test(kind) ? "tense" : /free/i.test(kind) ? "silly" : "heroic");

const SONGS = {
  // a liquid groove to talk over: half-time drums, no lead, a soft arp, add9 pads
  lobby: () => ({
    bpm: 170, root: 45, mode: "dorian", A: [0, 6, 3, 4], B: [0, 3, 2, 6], vol: 0.8, form: FORMS.lobby,
    ...HALF, bass: BASSES.liquid, lead: null, arp: "x.......x...x...", arpDuty: 0.25, arpVol: 0.03, pad: 1, add9: true,
  }),
  game: (seed, kind) => {
    const h = hash(seed), m = MOODS[moodOf(seed, kind)], progs = pick(m.progs, h, 5);
    return {
      bpm: pick(m.bpm, h, 2), root: pick([45, 47, 48, 50, 52], hash(seed + "key"), 0), mode: m.mode, A: progs[0], B: progs[1], vol: 1,
      form: FORMS[m.form], ...BEATS[pick(m.beats, h, 8)], bass: BASSES[pick(m.basses, h, 11)],
      lead: m.noLead ? null : pick(LEADS, h, 14), leadSeed: h, leadDuty: m.leadDuty, echo: (h >>> 17) % 2 === 0,
      arp: m.arp, arpDuty: m.arpDuty, pad: 0.5,
    };
  },
  board: (seed) => ({
    bpm: 170, root: 48, mode: "major", A: [0, 4, 5, 3], B: [3, 4, 0, 0], vol: 1, form: FORMS.board,
    ...HALF, bass: BASSES.bounce, lead: pick(LEADS, hash(`board${seed}`), 3), leadSeed: hash(`board${seed}`), leadDuty: 0.25, echo: true,
    arp: "x.x.x.x.x.x.x.x.", arpDuty: 0.25, pad: 0.7, add9: true,
  }),
  final: () => ({
    bpm: 174, root: 48, mode: "major", A: [BVI, BVII, 0, 0], B: [5, 3, 4, 4], vol: 1.12, form: FORMS.final,
    ...BEATS.twostep, bass: BASSES.steady, lead: "x..x..x.x.x.x...", leadSeed: 3, leadDuty: 0.25, echo: true,
    arp: "xxxxxxxxxxxxxxxx", arpDuty: 0.5, pad: 1,
  }),
  // The sizzle: one bar = 1.4 s = one cut, so every cut lands on a downbeat.
  // Its arc, bar by bar after the 2-bar title card (a drone, then a roll that
  // speeds up and rises into a silent beat): 8 cuts on the Amen, a 2-bar
  // half-time breath at the midpoint, a 2-bar build, a lifted second drop,
  // a 2-bar build into silence, and the end card's big major chord (outro).
  trailer: () => ({
    bpm: 1200 / 7, root: 45, mode: "minor", A: [0, 5, 2, 6], B: [5, 6, 0, 0], vol: 1, intro: 1, introLevel: -5, arpRange: 65,
    form: { loop: 0, secs: [
      { name: "A", bars: 4, drums: "main", lead: true, arp: true, prog: "A", level: -3.5 },
      { name: "A2", bars: 4, drums: "main", lead: true, arp: true, prog: "A", open: true, level: -2.5 }, // open hats: A climbs
      { name: "breath", bars: 2, drums: "breath", lead: "call", arp: false, prog: "A", low: true, level: -2 },
      { name: "build", bars: 2, drums: "build", lead: false, arp: true, chords: [3, E_MAJ], level: -7, rise: true },
      { name: "B", bars: 6, drums: "main", lead: true, leadUp: 12, arp: true, arpDouble: true, bass: "synco", prog: "B", lift: true, open: true, level: 1.5 },
      { name: "build", bars: 2, drums: "build", lead: false, arp: true, chords: [3, E_MAJ], level: -7, rise: true }, // iv, V: a fake-out into F the first time, home to A major the second
      { name: "card", bars: 2, end: true, level: -9 }, // (the glue and limiter pull it back up) // the end card: one big chord (the song ends here)
    ] },
    ...BEATS.amen, bass: BASSES.rolling, lead: "x..x..x.x.x.x...", leadSeed: 11, leadDuty: 0.25, echo: true,
    // the hook climbs the minor triad (A C E A), which the end card's sound logo answers in major (A C# E A)
    hook: [[[0, 0], [3, 2], [6, 4], [8, 7], [10, 6], [12, 4]], [[0, 2], [3, 4], [6, 5], [8, 7], [10, 5], [12, 4]],
      [[0, 4], [3, 6], [6, 7], [8, 9], [10, 7], [12, 6]], [[0, 6], [3, 4], [6, 2], [8, 1]]],
    arp: "xxxxxxxxxxxxxxxx", arpDuty: 0.5, pad: 0.6,
  }),
};

// The lead's tune: 4 bars made from one motif, in scale steps from the key's
// tonic (strong beats then snap to the chord): stated, sequenced up a third,
// varied at the end, then an answer that steps back down home. The walk
// stays within a 5th either side. Returns per bar a list of [step, degree].
function melody(seed, rhythm) {
  const r = rng(seed * 2654435761), hits = [...rhythm].map((c, i) => (c === "x" ? i : -1)).filter((i) => i >= 0);
  const motif = [pick([0, 2, 4], seed, 1)];
  for (let k = 1; k < hits.length; k++) {
    let d = motif[k - 1] + [-2, -1, -1, 1, 1, 2, 0][Math.floor(r() * 7)];
    if (Math.abs(d) > 4) d -= 2 * Math.sign(d);
    motif.push(d);
  }
  const vary = motif.map((d, k) => (k >= motif.length - 2 ? d + (r() < 0.5 ? 1 : -1) : d));
  const answerHits = [...ANSWER].map((c, i) => (c === "x" ? i : -1)).filter((i) => i >= 0);
  let at = Math.max(2, Math.min(4, motif[motif.length - 1] + 1));
  const home = answerHits.map((_, k) => { if (k === answerHits.length - 1) return 0; const d = at; at = Math.max(k === answerHits.length - 2 ? 1 : 0, at - (r() < 0.6 ? 1 : 2)); return d; });
  return [
    hits.map((i, k) => [i, motif[k]]),
    hits.map((i, k) => [i, motif[k] + 2]),
    hits.map((i, k) => [i, vary[k]]),
    answerHits.map((i, k) => [i, home[k]]),
  ];
}

// The master chain every mix goes through (the game's and the sizzle
// recorder's): a limiter, a trim for the compressor's own automatic makeup
// gain, then a gentle soft clip that catches the few overs a Web Audio
// compressor (not a brickwall) lets through. Returns the node to connect into.
export function masterChain(ac, dest, { trim: level = 0.84, release = 0.08 } = {}) {
  const limit = ac.createDynamicsCompressor(), trim = ac.createGain(), clip = ac.createWaveShaper();
  limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = release;
  trim.gain.value = level;
  const curve = new Float32Array(1025);
  for (let i = 0; i < curve.length; i++) { const x = (i / 512) - 1; curve[i] = Math.abs(x) < 0.8 ? x : Math.sign(x) * (0.8 + 0.15 * Math.tanh((Math.abs(x) - 0.8) / 0.15)); }
  clip.curve = curve; clip.oversample = "4x";
  limit.connect(trim).connect(clip).connect(dest);
  return limit;
}

export function createMusic(ac, out) {
  // pulse waves at a few duty cycles, the chip sound
  const pulses = {};
  function pulse(duty) {
    if (pulses[duty]) return pulses[duty];
    const n = 48, real = new Float32Array(n), imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return (pulses[duty] = ac.createPeriodicWave(real, imag));
  }
  // stepped noise (held for a few samples, like a chip's noise channel)
  let noiseBuf = null;
  function noiseBuffer() {
    if (noiseBuf) return noiseBuf;
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2.5, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < d.length; i++) { if (i % 3 === 0) v = Math.random() * 2 - 1; d[i] = v; }
    return noiseBuf;
  }
  const bus = ac.createGain(), dipper = ac.createGain(); // ducking: for pause, and under key sound effects
  bus.connect(dipper).connect(out);


  // ------------------------------------------------------------ instruments
  function env(g, t, peak, a, d, ring = false) {
    g.gain.value = 0; // not the default 1 for a sample before the first event
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    if (ring) { g.gain.setTargetAtTime(0, t + a, d / 3); g.gain.linearRampToValueAtTime(0, t + a + d); } // a slower, bell-like fade that holds on
    else g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function osc(type) {
    const o = ac.createOscillator();
    if (typeof type === "number") o.setPeriodicWave(pulse(type)); else o.type = type;
    return o;
  }
  function noiseHit(t, dst, { freq, type, q = 1, vol, dur, sweep = 0 }) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuffer(); s.loop = dur > 0.5; f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) { // a riser: the filter opens and the level climbs (linearly, so it's heard all the way)
      f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
      g.gain.value = 0; g.gain.setValueAtTime(0.006, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.95); g.gain.linearRampToValueAtTime(0, t + dur);
    } else env(g, t, vol, 0.001, dur);
    s.connect(f).connect(g).connect(dst);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    return g;
  }
  // do something on the audio clock (not the wall clock, which keeps going while a context is suspended)
  function later(t, fn) {
    const c = ac.createConstantSource(); c.offset.value = 0; c.connect(dipper);
    c.onended = () => { c.disconnect(); fn(); };
    c.start(); c.stop(Math.max(ac.currentTime + 0.01, t));
  }
  function kick(t, dst, v) {
    const o = osc("triangle"), g = ac.createGain();
    o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.09);
    env(g, t, 0.75 * v, 0.002, 0.16);
    o.connect(g).connect(dst); o.start(t); o.stop(t + 0.3);
    noiseHit(t, dst, { freq: 2500, type: "lowpass", vol: 0.25 * v, dur: 0.015 }); // the click
  }
  function snare(t, dst, v, kind, pitch = 0) {
    const vol = kind === "o" ? 0.55 : kind === "g" ? 0.14 : 0.4, p = 2 ** (pitch / 12);
    noiseHit(t, dst, { freq: 3000 * p, type: "bandpass", q: 0.6, vol: vol * v, dur: kind === "g" ? 0.05 : 0.15 });
    const o = osc(0.5), g = ac.createGain(); // a pitched body under the noise
    o.frequency.setValueAtTime(260 * p, t); o.frequency.exponentialRampToValueAtTime(150 * p, t + 0.06);
    env(g, t, vol * 0.35 * v, 0.001, 0.06);
    o.connect(g).connect(dst); o.start(t); o.stop(t + 0.1);
  }
  function hat(t, dst, v, kind) {
    noiseHit(t, dst, { freq: 9000, type: "highpass", vol: (kind === "o" ? 0.1 : kind === "g" ? 0.03 : 0.06) * v, dur: kind === "o" ? 0.12 : 0.025 });
  }
  // a crash: shorter in the game (a long wash masks the effects), and softer for reduced motion
  let soft = false;
  function crash(t, dst, v, dur = 1.1) { noiseHit(t, dst, { freq: soft ? 5000 : 7000, type: "highpass", vol: (soft ? 0.06 : 0.12) * v, dur }); }
  function note(t, dst, midi, { type, vol, dur, cutoff = 0, attack = 0.003, vibrato = 0, from = null, ring = false }) {
    const o = osc(type), g = ac.createGain();
    if (from != null) { o.frequency.setValueAtTime(hz(from), t); o.frequency.exponentialRampToValueAtTime(hz(midi), t + 0.05); } // a slide into the note
    else o.frequency.value = hz(midi);
    if (vibrato) { // delayed vibrato, the classic chip lead
      const lfo = ac.createOscillator(), depth = ac.createGain();
      lfo.frequency.value = 6; depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(vibrato, t + Math.min(0.25, dur * 0.6));
      lfo.connect(depth).connect(o.detune); lfo.start(t); lfo.stop(t + attack + dur + 0.05);
    }
    env(g, t, vol, attack, dur, ring);
    if (cutoff) { const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff; o.connect(f).connect(g); }
    else o.connect(g);
    g.connect(dst); o.start(t); o.stop(t + attack + dur + 0.05);
  }
  // one 16th of arpeggio: the chord's three notes cycled inside it (32nd triplets)
  function arp(t, dst, notes, len, { duty, vol }) {
    const o = osc(duty), g = ac.createGain(), slice = len / 3;
    notes.forEach((n, k) => o.frequency.setValueAtTime(hz(n), t + k * slice));
    env(g, t, vol, 0.002, len * 0.95);
    o.connect(g).connect(dst); o.start(t); o.stop(t + len + 0.03);
  }

  // ------------------------------------------------------------ the sequencer
  const at = (pat, n) => (pat ? pat[n % pat.length] : ".");
  const scaleOf = (s) => MODES[s.mode] || MODES.minor;
  const fold = (m) => 28 + ((((m - 28) % 12) + 12) % 12); // a root folded into E1-D#2 (41-78 Hz)
  function chordNotes(s, deg) { // a triad as midi notes: a scale degree, or a borrowed {st, q}
    if (typeof deg === "object") return [s.root + deg.st, s.root + deg.st + (deg.q === "min" ? 3 : 4), s.root + deg.st + 7];
    const sc = scaleOf(s), n = (k) => s.root + sc[(deg + k) % 7] + 12 * Math.floor((deg + k) / 7);
    return [n(0), n(2), n(4)];
  }
  function degreeNote(s, deg, d) { // d scale steps above the chord's root (for the lead and the add9)
    const sc = scaleOf(s);
    if (typeof deg === "object") { const maj = MODES.major, k = d; return s.root + deg.st + maj[((k % 7) + 7) % 7] + 12 * Math.floor(k / 7); }
    const k = deg + d;
    return s.root + sc[((k % 7) + 7) % 7] + 12 * Math.floor(k / 7);
  }
  // the lead's note: d scale steps from the key's tonic (borrowed chords: the
  // parallel minor), strong beats snapped to the chord
  function leadNote(s, deg, d, i) {
    const sc = typeof deg === "object" ? MODES.minor : scaleOf(s);
    let m = s.root + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
    if (i % 4 === 0) {
      const pcs = chordNotes(s, deg).map((n) => n % 12);
      for (const o of [0, -1, 1, -2, 2]) if (pcs.includes((m + o + 120) % 12)) { m += o; break; }
    }
    // the octave nearest the last note (a smooth line), kept within E4-A6
    const prev = s.lastLead ?? 76;
    let best = m + 24;
    for (const c of [m, m + 12, m + 24, m + 36]) if (c >= 64 && c <= 93 && Math.abs(c - prev) < Math.abs(best - prev)) best = c;
    return (s.lastLead = best);
  }
  // ------------------------------------------------------------ players
  // One player per song, so a new song starts on the old one's next downbeat
  // while the old one plays on until then. A game song can be DRIVEN by the
  // game: it vamps through the intro, builds over the countdown and drops on
  // GO, takes its breakdown at half time and a hotter layer for the last
  // seconds; any other song runs its form by itself.
  const VAMP = { name: "vamp", bars: 1, drums: "half", lead: false, arp: true, prog: "A", low: true };
  const BUILD = { name: "build", bars: 2, drums: "build", lead: false, arp: true, prog: "B" };
  let cur = null, fading = [], timer = null, paused = false, pausedAt = 0, enabled = true;
  const resumeAt = {}; // where the lobby / board songs were, to pick up there next time
  const SPEED_BPM = [0, 6, 11, 15, 18, 20, 22, 24], SPEED_KEY = [0, 1, 2, 3, 5]; // the gauntlet's steps, capped
  const firstMain = (secs) => Math.max(0, secs.findIndex((x) => x.drums === "main"));

  function newPlayer(which, seed, kind, key, at) {
    const s = SONGS[which](seed, kind);
    s.fill = FILLS[hash(`${which}${seed}`) % FILLS.length];
    if (s.lead) s.tune = s.hook || melody(s.leadSeed || hash(seed) || 1, s.lead); // a song can bring its own tune
    s.baseBpm = s.bpm; s.baseRoot = s.root;
    const gain = ac.createGain(); gain.connect(bus);
    s.bassGain = ac.createGain(); s.bassGain.connect(gain);
    return { s, gain, name: which, key, step: 0, bar: 0, pb: 0, next: at, k: 0, sec: s.form.secs[0], inSec: 0, first: true,
      section: "main", driven: false, hot: false, cue: null, dropT: null, buildT: null, allowBuild: false, stopAt: null,
      at, speedNext: null, outroAt: null, riser: null };
  }
  function enter(P, name) {
    const secs = P.s.form.secs;
    if (name === "vamp") { P.k = -1; P.sec = VAMP; }
    else if (name === "build") { P.k = -1; P.sec = BUILD; P.buildT = null; }
    else { let k = secs.findIndex((x) => x.name === name); if (k < 0) k = firstMain(secs); P.k = k; P.sec = secs[k]; if (name === "break") P.allowBuild = true; }
    P.inSec = 0;
  }
  // at the end of each bar: move through the form (or hold, or take a cue)
  function advance(P) {
    const { secs, loop = 0 } = P.s.form;
    P.inSec++; P.pb++; P.first = false;
    if (P.sec.end) return; // the end card: the song is over, nothing comes back in under its fade
    if (P.speedNext != null) { // the gauntlet's speed-up lands on the bar line
      const l = P.speedNext; P.speedNext = null;
      P.s.bpm = P.s.baseBpm + SPEED_BPM[Math.min(l, SPEED_BPM.length - 1)];
      P.s.root = P.s.baseRoot + SPEED_KEY[Math.min(l, SPEED_KEY.length - 1)];
      P.s.fastHats = l >= SPEED_BPM.length - 1;
    }
    if (P.cue) { enter(P, P.cue); P.cue = null; return; }
    if (P.sec === VAMP) { P.inSec = 0; return; } // hold until the countdown
    if (P.sec === BUILD) { if (P.dropT == null && P.inSec >= BUILD.bars) enter(P, secs[firstMain(secs)].name); return; }
    if (P.inSec < P.sec.bars) return;
    let k = P.k + 1 >= secs.length ? loop : P.k + 1;
    if (P.driven) { // the game decides when the breakdown and build come
      for (let g = 0; g < secs.length; g++) {
        const x = secs[k], skip = (x.name === "break") || (x.name === "build" && !P.allowBuild) || (P.hot && (x.low || x.drums !== "main"));
        if (!skip) break;
        k = k + 1 >= secs.length ? loop : k + 1;
      }
      if (secs[k].name === "build") P.allowBuild = false;
    }
    P.prevBuild = P.sec?.drums === "build"; P.k = k; P.sec = secs[k]; P.inSec = 0;
  }

  const dbGain = (db) => 10 ** (db / 20);
  // the one big chord (with the win jingle's arpeggio over it: the game's sound logo)
  function hitOutro(s, t, dst, v, len = 2.6, hiss = 0.28) {
    const home = [s.root, s.root + 4, s.root + 7]; // a major tonic chord (a Picardy third in the minor songs)
    kick(t, dst, v); snare(t, dst, v, "o"); noiseHit(t, dst, { freq: 6000, type: "highpass", vol: hiss * v, dur: Math.min(2, len) });
    for (const n of home) note(t, dst, n + 12, { type: 0.5, vol: 0.045 * v, dur: len, attack: 0.01, ring: true });
    [0, 4, 7, 12].forEach((st, k) => note(t + k * 0.09, dst, home[0] + 24 + st, { type: 0.25, vol: 0.06 * v, dur: k === 3 ? len * 0.8 : 0.2, vibrato: k === 3 ? 25 : 0, ring: k === 3 }));
    note(t, dst, fold(home[0]), { type: "triangle", vol: 0.12 * v, dur: len, ring: true });
    note(t, dst, fold(home[0]) + 12, { type: 0.25, vol: 0.08 * v, dur: len * 0.8, cutoff: 1800, ring: true }); // harmonics a phone speaker can play
  }
  function playStep(P, t) {
    const s = P.s, dst = P.gain, i = P.step % 16, v = s.vol, sixteenth = 60 / s.bpm / 4, step = P.step;
    if (i === 0 && P.bar === 0 && s.introLevel != null) P.gain.gain.setValueAtTime(dbGain(s.introLevel), t); // the title card sits under the first drop
    if (i === 0 && P.inSec === 0 && P.sec.level != null && !(s.intro && P.bar < s.intro)) {
      const g = P.gain.gain, from = dbGain(P.sec.level);
      g.cancelScheduledValues(t);
      // a build climbs from its level to just under the drop's (a ramp needs an explicit start: it runs from the last event)
      if (P.sec.rise) { g.setValueAtTime(from, t); g.linearRampToValueAtTime(dbGain(-4.5), t + P.sec.bars * 16 * sixteenth - 4 * sixteenth); }
      else g.setTargetAtTime(from, t, 0.02);
    }
    if (P.sec.end) { if (P.inSec === 0 && i === 0 && !P.ended) { P.ended = true; hitOutro(s, t, dst, v, P.sec.bars * 16 * sixteenth + 0.9, 0.15); } return; } // rings through the card and the fade after it
    const intro = s.intro && P.bar < s.intro, sec = P.sec, inSec = P.inSec, pb = P.pb;
    const { secs, loop = 0 } = s.form, nextSec = P.k >= 0 ? secs[P.k + 1] || secs[loop] : null;
    const prog = sec.prog === "B" && s.B ? s.B : s.A, deg = sec.chords ? sec.chords[inSec % sec.chords.length] : prog[pb % prog.length], chord = chordNotes(s, deg);
    const building = sec.drums === "build";
    if (building && P.buildT == null) P.buildT = t;
    // the build's progress and steps left, and the silent beat before the drop (timed to GO when the game set one)
    const left = !building ? 99 : P.dropT != null ? Math.round((P.dropT - t) / sixteenth) : (sec.bars - inSec) * 16 - i;
    const q = !building ? 0 : P.dropT != null ? Math.min(1, (t - P.buildT) / Math.max(0.1, P.dropT - P.buildT)) : (inSec + i / 16) / sec.bars;
    const drop = building && left <= 4;
    if (P.outroAt != null && t >= P.outroAt - 0.001) { P.section = "outro"; P.outroAt = null; }
    if (P.section === "outro") {
      if (!s.outroDone) { s.outroDone = true; hitOutro(s, t, dst, v, 4); } // one last big chord, on the beat
      return;
    }
    if (intro) {
      if (i === 0 && P.bar === 0) { note(t, s.bassGain, fold(chord[0]), { type: "triangle", vol: 0.3 * v, dur: 0.6, from: fold(chord[0]) + 12 }); crash(t, dst, v); } // the logo lands
      if (i === 0) note(t, dst, fold(chord[0]) + 12, { type: "triangle", vol: 0.26 * v, dur: sixteenth * 14 });
      if (P.bar === s.intro - 1 && i < 12) { // the bar before the drop: a roll that speeds up (8ths, 16ths, 32nds) and rises; then a silent step
        hat(t, dst, v * (0.5 + i / 16), "x");
        if (i % 2 === 0 || i >= 8) snare(t, dst, v * (0.3 + i / 24), "x", i);
        if (i >= 12) snare(t + sixteenth / 2, dst, v * (0.4 + i / 24), "x", i + 1);
      }
    } else {
      // drums: the section's beat, a fill in the last bar of every 4 (every 2 when hot),
      // a crash on each new section (a full fill only in full-drum sections; half-time
      // gets a light one before the next section unless that's a build; a new song opens
      // without a crash)
      const outFill = P.stopAt != null && P.stopAt - t <= 4 * sixteenth + 0.001; // handing over to the next song
      const fill = sec.drums === "main" && (inSec % 4 === 3 || outFill);
      const lightFill = sec.drums === "half" && sec !== VAMP && inSec === sec.bars - 1 && nextSec?.drums !== "build" && i >= 12;
      const kit = fill ? s.fill : sec.drums === "half" ? HALF : sec.drums === "breath" ? BREATH : sec.drums === "sparse" ? SPARSE : sec.drums === "none" ? null : s;
      const n = kit === s ? inSec * 16 + i : i; // 32-step breaks run over bar pairs within a section
      if (inSec === 0 && i === 0 && !building && sec !== VAMP && sec.drums !== "none" && !P.first) {
        if (P.prevBuild) { noiseHit(t, dst, { freq: 7000, type: "highpass", vol: 0.14 * v, dur: 2.5 }); note(t, s.bassGain, fold(chord[0]), { type: "triangle", vol: 0.35 * v, dur: 0.5, from: fold(chord[0]) + 12 }); } // the drop lands
        else crash(t, dst, v);
      }
      if (building) { // a roll: 8ths, then 16ths, rising, over a riser; then a silent beat before the drop
        // 8ths, then 16ths in the last bar, then a beat of rest
        if (!drop && (left <= 16 || i % 2 === 0)) snare(t, dst, v * 0.55 * (0.3 + 0.6 * q), "x", Math.round(q * 9));
        if (!drop && left <= 8) snare(t + sixteenth / 2, dst, v * 0.5 * (0.3 + 0.6 * q), "x", Math.round(q * 9) + 1); // 32nds at the very end
        if (t === P.buildT) {
          const len = (left - 4) * sixteenth;
          if (len > 0.3) P.riser = noiseHit(t, dst, { freq: 400, type: "highpass", vol: 0.09 * v, dur: len, sweep: 5000 });
        }
        if (!drop && (left <= 16 ? i % 2 === 0 : i % 4 === 0)) kick(t, dst, v * 0.7); // 8ths in the last bar
        if (t === P.buildT && sec.rise) { // a pitched riser under the noise one
          const len = (left - 4) * sixteenth, o = osc(0.5), g = ac.createGain();
          if (len > 0.3) {
            o.frequency.setValueAtTime(hz(s.root + 12), t); o.frequency.exponentialRampToValueAtTime(hz(s.root + 36), t + len);
            g.gain.value = 0; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04 * v, t + len); g.gain.linearRampToValueAtTime(0, t + len + 0.01);
            o.connect(g).connect(dst); o.start(t); o.stop(t + len + 0.05);
          }
        }
      } else if (kit) {
        if (lightFill) snare(t, dst, v * 0.6, "x", i - 12);
        const k = at(kit.kick, n), sn = at(kit.snare, n);
        let hh = at(kit.hat, n);
        if ((P.hot || s.fastHats || sec.open) && kit === s && i % 4 === 2) hh = "o"; // the last seconds (or a lifted section): open hats on the off-beats
        if (k !== ".") { // the kick, and the sub ducks a little under it
          kick(t, dst, v);
          const sc = s.bassGain.gain; sc.setValueAtTime(sc.value, t - 0.003); sc.linearRampToValueAtTime(0.55, t); sc.setTargetAtTime(1, t + 0.015, 0.025);
        }
        if (sn !== ".") snare(t, dst, v, sn);
        if (hh !== ".") hat(t, dst, v, hh);
      }
      // bass
      const b = at(sec.bass ? BASSES[sec.bass] : s.bass, i);
      if (b !== "." && sec.drums !== "none" && !drop && (!building || left <= 16)) { // (a build keeps its bass for the last bar)
        const seventh = typeof deg === "object" ? 10 : ((scaleOf(s)[(deg + 6) % 7] - scaleOf(s)[deg] + 12) % 12);
        const r = fold(chord[0]), up = b === "o" ? 12 : b === "f" ? 7 : b === "b" ? seventh : 0, bv = sec.low ? 0.6 : 1;
        note(t, dst, r + 12 + up, { type: 0.25, vol: 0.12 * v * bv, dur: sixteenth * 1.8, cutoff: sec.low ? 500 : P.hot ? 3000 : 1400, from: b === "s" ? r + seventh : null }); // the grit
        if (!sec.low) note(t, s.bassGain, r + (b === "f" ? 7 : 0), { type: "triangle", vol: 0.24 * v * bv, dur: sixteenth * 1.8, from: b === "s" ? r - 2 : null }); // the sub (not in a breakdown)
      }
      // lead: the song's tune, bar by bar ("call" plays only the first half of each bar)
      if (i === 0 && (pb % 4 === 0 || inSec === 0)) s.lastLead = null; // each phrase starts from the same place, so the hook repeats
      if (s.tune && sec.lead) {
        const line = s.tune[pb % 4], hit = line.find(([st]) => st === i);
        if (hit && !(sec.lead === "call" && i >= 8 && pb % 4 !== 3)) { // a call still lands the answer's last note
          const later = line.find(([st]) => st > i), len = Math.min(sixteenth * 3, ((later ? later[0] : 16) - i) * sixteenth * 0.9);
          let m = leadNote(s, deg, hit[1], i);
          if (sec.leadUp && m + sec.leadUp <= 96) m += sec.leadUp;
          const scoop = pb % 4 === 0 && i === line[0][0] && !soft; // the chip bend: a phrase slides up into its first note
          note(t, dst, m, { type: s.leadDuty || 0.25, vol: 0.085 * v, dur: len, vibrato: len > 0.2 ? 20 : 0, cutoff: 5000, from: scoop ? m - 2 : null });
          const clash = line.some(([st]) => st > i && st <= i + 4); // the echo only in the tune's gaps, an octave down
          if (s.echo && !clash) note(t + sixteenth * 3, dst, m - 12, { type: s.leadDuty || 0.25, vol: 0.035 * v, dur: len * 0.8, cutoff: 3000 });
          s.leadAt = step;
        }
      }
    }
    // arp: the section says on, off, or "gaps" (only where the lead rests: call and response)
    const leadNow = s.leadAt != null && step - s.leadAt <= 1;
    const introHush = intro && P.bar === s.intro - 1 && i >= 12; // the intro's last beat before the drop
    if (!drop && !introHush && at(s.arp, i) !== "." && (intro || sec.arp === true || (P.hot && sec.arp !== "gaps") || (sec.arp === "gaps" && !leadNow))) {
      // a song with an arpRange keeps the arp in one octave from there (the nearest inversion, under the lead)
      const up = s.arpRange ? chord.map((n) => s.arpRange + ((n - s.arpRange) % 12 + 12) % 12).sort((a, b) => a - b)
        : chord.map((n) => { let m = n + 24 + (P.hot ? 12 : 0); while (m > 91) m -= 12; return m; }), order = i % 2 ? [up[2], up[1], up[0]] : up;
      const base = (s.arpVol ?? 0.05) * (s.arpDuty === 0.5 ? 0.7 : 1) * (leadNow ? 0.6 : 1);
      arp(t, dst, order, sixteenth, { duty: s.arpDuty, vol: (intro ? Math.min(0.035, 0.02 + 0.01 * (P.bar + i / 16)) : base) * v });
      if (sec.arpDouble) arp(t, dst, order.map((n) => n - 12), sixteenth, { duty: s.arpDuty, vol: base * 0.6 * v }); // doubled an octave down
    }
    if (s.pad && i === 0 && (!sec.low || sec.drums === "breath") && !drop && !P.hot) { // soft held chord (a narrow pulse, filtered); add9 on the calm songs; fuller in a lift
      const tones = s.add9 ? [...chord, degreeNote(s, deg, 1) + 12] : chord;
      const len = building && left <= 16 ? Math.max(2, left - 5) : sec.drums === "breath" ? 17 : 14; // clear of the silent beat; a breath's pad holds on (no dropout)
      for (const n of tones.map((x) => { let m = x + 12; while (m > 76) m -= 12; return m - 12; })) note(t, dst, n + 12, { type: 0.25, vol: 0.018 * s.pad * v * (intro || sec.drums === "breath" ? 2.5 : 1) * (sec.lift ? 1.5 : 1), dur: sixteenth * len, attack: sixteenth * 3, cutoff: 1800 });
    }
  }
  function run(P, ahead) {
    if (P.next < ac.currentTime - 0.25) P.next = ac.currentTime + 0.02; // fell behind (a throttled tab): skip ahead
    while (P.next < ahead && (P.stopAt == null || P.next < P.stopAt - 0.001)) {
      if (P.dropT != null && P.next >= P.dropT - 0.002) { // GO: the drop lands exactly on it
        P.next = P.dropT; P.dropT = null; P.step = 0; P.bar = s0(P); P.pb = 0; enter(P, P.s.form.secs[firstMain(P.s.form.secs)].name); P.first = false;
        if (P.next < ac.currentTime) P.next = ac.currentTime + 0.02;
      }
      playStep(P, P.next);
      P.next += 60 / P.s.bpm / 4;
      if (++P.step % 16 === 0) { P.bar++; if (P.bar > (P.s.intro || 0)) advance(P); }
    }
  }
  const s0 = (P) => P.s.intro || 0;
  function schedule() {
    if (!cur && !fading.length) { clearInterval(timer); timer = null; return; } // nothing playing: stop ticking
    if (paused || !enabled || ac.state !== "running") return;
    const ahead = ac.currentTime + 0.12;
    for (const P of fading) run(P, ahead);
    fading = fading.filter((P) => {
      if (P.next < P.stopAt - 0.001) return true;
      if (P.name === "lobby" || P.name === "board") resumeAt[P.name] = lobbyState(P); // it stopped on a downbeat
      return false;
    });
    if (cur) run(cur, ahead);
  }
  const lobbyState = (P) => ({ step: P.step, bar: P.bar, pb: P.pb, k: P.k, sec: P.sec, inSec: P.inSec });
  const ensureTimer = () => { timer ??= setInterval(schedule, 25); };

  return {
    // start a song (or keep the one that's playing if it's the same), on the old one's next downbeat
    play(which, seed = "", kind = "") {
      const key = `${which}:${seed}:${kind}`;
      if (cur && key === cur.key) return;
      if (!SONGS[which]) return;
      const now = ac.currentTime;
      let at = now + 0.05, onBeat = false;
      if (cur && cur.next <= cur.at + 0.001) { // the current song hasn't sounded yet: just replace it
        at = Math.max(at, cur.at); onBeat = true;
        cur.gain.disconnect(); cur = null;
      } else if (cur) {
        const sx = 60 / cur.s.bpm / 4, toBar = (16 - (cur.step % 16)) % 16, toBeat = (4 - (cur.step % 4)) % 4;
        if (!paused && cur.section !== "outro") { // (after a stinger, straight in)
          const down = cur.next + toBar * sx, beat = cur.next + toBeat * sx;
          at = down - now <= 16 * sx + 0.01 ? down : beat; onBeat = true;
        }
        if (at < now + 0.02) at = now + 0.05;
        cur.stopAt = at; fading.push(cur);
        const g = cur.gain.gain; g.cancelAndHoldAtTime(at); g.linearRampToValueAtTime(0.0001, at + 0.5);
        const old = cur.gain; later(at + 0.7, () => old.disconnect());
      }
      const P = newPlayer(which, seed, kind, key, at);
      if (resumeAt[which]) Object.assign(P, resumeAt[which], { first: false });
      if (which === "game") enter(P, "vamp"); // a game song vamps until the game says go
      else if (which !== "lobby") P.first = false; // board and final come in with a crash
      const g = P.gain.gain; g.value = 0; g.setValueAtTime(0.0001, now);
      if (onBeat) g.setValueAtTime(1, at); else { g.setValueAtTime(0.3, at); g.linearRampToValueAtTime(1, at + 0.15); }
      cur = P;
      ensureTimer();
      schedule();
    },
    // the countdown: build now, and drop into the groove exactly `secs` from now (on GO)
    countdown(secs) {
      if (!cur || cur.name !== "game") return;
      const dropT = ac.currentTime + secs, sx = 60 / cur.s.bpm / 4;
      const n = Math.max(0, Math.round((dropT - cur.next) / sx)); // whole steps to GO: the grid lands on it
      cur.next = dropT - n * sx; cur.step = (16 - (n % 16)) % 16;
      cur.driven = true; cur.dropT = dropT; enter(cur, "build");
    },
    // GO without a countdown (games that don't use the shared clock): drop on the next beat
    go() {
      if (!cur || cur.name !== "game" || cur.sec !== VAMP) return;
      const sx = 60 / cur.s.bpm / 4; cur.dropT = cur.next + ((4 - (cur.step % 4)) % 4) * sx;
    },
    // half time: the breakdown (and the build out of it) at the next bar
    half() { if (cur?.driven && !cur.hot) cur.cue = "break"; },
    // the last seconds: hotter (16th hats, fills every 2 bars, arp always on), no breakdowns
    // (open off-beat hats, the arp up an octave, a brighter bass, no pad; fills stay every 4 bars)
    hot(on = true) { if (!cur || cur.name !== "game") return; cur.hot = on; if (on && (cur.sec.low || cur.sec.drums !== "main") && cur.sec !== VAMP && cur.sec !== BUILD) cur.cue = cur.s.form.secs[firstMain(cur.s.form.secs)].name; },
    // the gauntlet's speed-ups, WarioWare style: faster (capped at +24 bpm, then busier hats) and up in key (up to a 4th), from the next bar
    speed(level) { if (cur) cur.speedNext = level; },
    // the end of a game (or the trailer): stop the groove, one last big chord on the next beat
    outro() {
      if (!cur || cur.section === "outro") return;
      const sx = 60 / cur.s.bpm / 4; cur.s.outroDone = false;
      cur.outroAt = cur.next + ((4 - (cur.step % 4)) % 4) * sx;
    },
    // the song's key, so the win / lose jingles can play in it
    get key() { if (!cur) return null; const sc = scaleOf(cur.s); return { root: cur.s.root, mode: cur.s.mode, scale: sc, major: sc[2] === 4 }; },
    // music switched off: stop working at it
    enable(on) { enabled = on; if (on) { for (const P of [cur, ...fading]) if (P) P.next = Math.max(P.next, ac.currentTime + 0.05); } },
    stop() {
      if (!cur) return;
      if (cur.name === "lobby" || cur.name === "board") resumeAt[cur.name] = lobbyState(cur);
      const old = cur.gain; old.gain.setTargetAtTime(0.0001, ac.currentTime, 0.15); later(ac.currentTime + 0.8, () => old.disconnect());
      cur = null;
    },
    // paused: the music ducks and stops in place, and carries on in time after
    // (every scheduled time shifts by the pause, so a drop still lands on GO)
    pause(on) {
      bus.gain.setTargetAtTime(on ? 0.25 : 1, ac.currentTime, 0.1);
      if (on === paused) return;
      paused = on;
      const now = ac.currentTime;
      if (on) {
        pausedAt = now;
        for (const P of [cur, ...fading]) if (P?.riser) { P.riser.gain.cancelScheduledValues(now); P.riser.gain.setTargetAtTime(0, now, 0.05); P.riser = null; }
        return;
      }
      const d = now + 0.05 - pausedAt;
      for (const P of [cur, ...fading]) {
        if (!P) continue;
        P.next = Math.max(P.next + d, now + 0.05);
        for (const k of ["dropT", "buildT", "stopAt", "outroAt"]) if (P[k] != null) P[k] += d;
      }
    },
    duck(down) { this.pause(down); },
    // a quick dip under an important sound effect (depth as a gain, 0.5 = -6 dB)
    soft(on) { soft = !!on; },
    dip(ms = 250, depth = 0.5) {
      const t = ac.currentTime, g = dipper.gain;
      g.cancelScheduledValues(t); g.setTargetAtTime(depth, t, 0.015); g.setTargetAtTime(1, t + ms / 1000, 0.08);
    },
    get playing() { return cur?.name || null; },
    // for tests and devtools: what's playing and where
    get state() { return cur && { song: cur.name, key: cur.key, section: cur.section === "outro" ? "outro" : cur.sec.name, bar: cur.pb, driven: cur.driven, hot: cur.hot, bpm: cur.s.bpm, paused }; },
  };
}
