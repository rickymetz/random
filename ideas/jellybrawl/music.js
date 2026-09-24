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
// back home. Each game gets its own song from its id and a mood from its
// kind (tense 1-vs-rest, silly free-for-all, heroic teams).
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
  synco: "..x..x.s.xo..x..",
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
// up (the lead an octave higher). Forms loop.
const FORMS = {
  game: [
    { bars: 8, drums: "main", lead: true, arp: true, prog: "A" },
    { bars: 8, drums: "main", lead: true, arp: "gaps", prog: "B", up: 12 },
    { bars: 4, drums: "half", lead: "call", arp: false, prog: "A" },
    { bars: 4, drums: "build", lead: false, arp: true, prog: "B" },
  ],
  tense: [
    { bars: 8, drums: "half", lead: "call", arp: true, prog: "A" },
    { bars: 8, drums: "main", lead: true, arp: "gaps", prog: "B" },
    { bars: 4, drums: "sparse", lead: false, arp: true, prog: "A" },
    { bars: 4, drums: "build", lead: false, arp: true, prog: "B" },
  ],
  lobby: [
    { bars: 8, drums: "half", lead: false, arp: true, prog: "A" },
    { bars: 8, drums: "sparse", lead: false, arp: true, prog: "B" },
  ],
  board: [
    { bars: 8, drums: "half", lead: false, arp: true, prog: "A" },
    { bars: 8, drums: "half", lead: "call", arp: "gaps", prog: "B" },
  ],
  final: [
    { bars: 8, drums: "main", lead: true, arp: true, prog: "A" },
    { bars: 8, drums: "main", lead: true, arp: "gaps", prog: "B", up: 12 },
  ],
};

// Chord progressions are scale degrees, or {st, q} for a borrowed chord
// (semitones above the root, "maj" or "min"): the Mario-style bVI-bVII-I.
const BVI = { st: 8, q: "maj" }, BVII = { st: 10, q: "maj" };
const MOODS = {
  // 1 vs the rest: dark and stalking, Phrygian, half-time into a Think break
  tense: { mode: "phrygian", bpm: [170, 172], beats: ["think", "twostep"], basses: ["stab", "synco"], progs: [[[0, 1, 0, 6], [5, 1, 0, 0]], [[0, 0, 1, 0], [6, 5, 1, 0]]], arp: "x...x...x.x.x...", arpDuty: 0.25, leadDuty: 0.125, form: "tense" },
  // free-for-all: bright and bouncy, Mixolydian, a skipping beat
  silly: { mode: "mixolydian", bpm: [174, 176], beats: ["skip", "rolling"], basses: ["bounce", "walk"], progs: [[[0, 6, 3, 0], [3, 4, 6, 0]], [[0, 3, 6, 0], [4, 3, 0, 6]]], arp: "x.x.x.x.x.x.x.x.", arpDuty: 0.125, leadDuty: 0.25, form: "game" },
  // teams: heroic, Dorian, the Amen break
  heroic: { mode: "dorian", bpm: [172, 174], beats: ["amen", "twostep"], basses: ["rolling", "synco", "steady"], progs: [[[0, 6, 5, 6], [3, 4, 0, 0]], [[0, 3, 6, 0], [5, 6, 0, 0]], [[0, 5, 6, 0], [3, 6, 4, 4]]], arp: "xxxxxxxxxxxxxxxx", arpDuty: 0.5, leadDuty: 0.25, form: "game" },
};
const moodOf = (kind = "") => (/vs rest/i.test(kind) ? "tense" : /free/i.test(kind) ? "silly" : "heroic");

const SONGS = {
  // a liquid groove to talk over: half-time drums, no lead, a soft arp, add9 pads
  lobby: () => ({
    bpm: 170, root: 45, mode: "dorian", A: [0, 5, 3, 4], B: [0, 3, 5, 6], vol: 0.9, form: FORMS.lobby,
    ...HALF, bass: BASSES.liquid, lead: null, arp: "x.......x...x...", arpDuty: 0.25, arpVol: 0.03, pad: 1, add9: true,
  }),
  game: (seed, kind) => {
    const h = hash(seed), m = MOODS[moodOf(kind)], progs = pick(m.progs, h, 5);
    return {
      bpm: pick(m.bpm, h, 2), root: pick([45, 47, 48, 50, 52], h, 3), mode: m.mode, A: progs[0], B: progs[1], vol: 1,
      form: FORMS[m.form], ...BEATS[pick(m.beats, h, 8)], bass: BASSES[pick(m.basses, h, 11)],
      lead: pick(LEADS, h, 14), leadSeed: h, leadDuty: m.leadDuty, echo: (h >>> 17) % 2 === 0,
      arp: m.arp, arpDuty: m.arpDuty, pad: 0.5,
    };
  },
  board: () => ({
    bpm: 170, root: 48, mode: "major", A: [0, 4, 5, 3], B: [3, 4, 0, 0], vol: 1, form: FORMS.board,
    ...HALF, bass: BASSES.bounce, lead: "x.x...x.x...x...", leadSeed: 7, leadDuty: 0.25, echo: true,
    arp: "x.x.x.x.x.x.x.x.", arpDuty: 0.25, pad: 0.7, add9: true,
  }),
  final: () => ({
    bpm: 174, root: 48, mode: "major", A: [BVI, BVII, 0, 0], B: [3, 4, BVI, BVII], vol: 1.12, form: FORMS.final,
    ...BEATS.twostep, bass: BASSES.steady, lead: "x..x..x.x.x.x...", leadSeed: 3, leadDuty: 0.25, echo: true,
    arp: "xxxxxxxxxxxxxxxx", arpDuty: 0.5, pad: 1,
  }),
  // the sizzle: one bar = 1.4 s, so every cut lands on a downbeat
  trailer: () => ({
    bpm: 1200 / 7, root: 45, mode: "minor", A: [0, 5, 2, 6], B: [3, 4, 0, 0], vol: 1, intro: 2,
    form: [{ bars: 8, drums: "main", lead: true, arp: true, prog: "A" }, { bars: 8, drums: "main", lead: true, arp: "gaps", prog: "B", up: 12 }],
    ...BEATS.amen, bass: BASSES.rolling, lead: "x..x..x.x.x.x...", leadSeed: 11, leadDuty: 0.25, echo: true,
    arp: "xxxxxxxxxxxxxxxx", arpDuty: 0.5, pad: 0.6,
  }),
};

// The lead's tune: 4 bars made from one motif, in scale steps from the
// chord's root: stated, sequenced up a third, varied at the end, then an
// answer that walks home. Returns per bar a list of [step, degree offset].
function melody(seed, rhythm) {
  const r = rng(seed * 2654435761), hits = [...rhythm].map((c, i) => (c === "x" ? i : -1)).filter((i) => i >= 0);
  const motif = [pick([0, 2, 4], seed, 1)];
  for (let k = 1; k < hits.length; k++) motif.push(motif[k - 1] + [-2, -1, -1, 1, 1, 2, 0][Math.floor(r() * 7)]);
  const vary = motif.map((d, k) => (k >= motif.length - 2 ? d + (r() < 0.5 ? 1 : -1) : d));
  const answerHits = [...ANSWER].map((c, i) => (c === "x" ? i : -1)).filter((i) => i >= 0);
  const top = Math.max(2, motif[0]), home = answerHits.map((_, k) => Math.round(top * (1 - k / (answerHits.length - 1))));
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
export function masterChain(ac, dest) {
  const limit = ac.createDynamicsCompressor(), trim = ac.createGain(), clip = ac.createWaveShaper();
  limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.08;
  trim.gain.value = 0.84;
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

  let song = null, songGain = null, name = null, seedKey = null, step = 0, bar = 0, next = 0, section = "main";
  let timer = null;

  // ------------------------------------------------------------ instruments
  function env(g, t, peak, a, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function osc(type) {
    const o = ac.createOscillator();
    if (typeof type === "number") o.setPeriodicWave(pulse(type)); else o.type = type;
    return o;
  }
  function noiseHit(t, dst, { freq, type, q = 1, vol, dur, sweep = 0 }) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuffer(); s.loop = dur > 0.5; f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur); // a riser
    env(g, t, vol, sweep ? dur * 0.9 : 0.001, sweep ? dur * 0.1 : dur);
    s.connect(f).connect(g).connect(dst);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
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
  function crash(t, dst, v) { noiseHit(t, dst, { freq: 6000, type: "highpass", vol: 0.16 * v, dur: 1.4 }); }
  function note(t, dst, midi, { type, vol, dur, cutoff = 0, attack = 0.003, vibrato = 0, from = null }) {
    const o = osc(type), g = ac.createGain();
    if (from != null) { o.frequency.setValueAtTime(hz(from), t); o.frequency.exponentialRampToValueAtTime(hz(midi), t + 0.05); } // a slide into the note
    else o.frequency.value = hz(midi);
    if (vibrato) { // delayed vibrato, the classic chip lead
      const lfo = ac.createOscillator(), depth = ac.createGain();
      lfo.frequency.value = 6; depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(vibrato, t + Math.min(0.25, dur * 0.6));
      lfo.connect(depth).connect(o.detune); lfo.start(t); lfo.stop(t + attack + dur + 0.05);
    }
    env(g, t, vol, attack, dur);
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
  // where we are in the song's form
  function place(s) {
    const form = s.form || FORMS.final, total = form.reduce((n, f) => n + f.bars, 0);
    let k = (((bar - (s.intro || 0)) % total) + total) % total;
    for (const f of form) { if (k < f.bars) return { sec: f, inSec: k }; k -= f.bars; }
    return { sec: form[0], inSec: 0 };
  }
  function playStep(t) {
    const s = song, dst = songGain, i = step % 16, v = s.vol, sixteenth = 60 / s.bpm / 4;
    const intro = s.intro && bar < s.intro;
    const { sec, inSec } = place(s);
    const prog = sec.prog === "B" && s.B ? s.B : s.A, deg = prog[bar % prog.length], chord = chordNotes(s, deg);
    if (section === "outro") {
      if (!s.outroDone) { // one last big chord and a crash, on the next step
        s.outroDone = true;
        const home = chordNotes(s, 0);
        kick(t, dst, v); snare(t, dst, v, "o"); noiseHit(t, dst, { freq: 6000, type: "highpass", vol: 0.28 * v, dur: 2 });
        for (const n of home) note(t, dst, n + 12, { type: 0.5, vol: 0.06 * v, dur: 6, attack: 0.01 });
        note(t, dst, home[0] + 24, { type: 0.125, vol: 0.07 * v, dur: 5, vibrato: 25 });
        note(t, dst, fold(home[0]), { type: "triangle", vol: 0.3 * v, dur: 6 });
      }
      return;
    }
    if (intro) {
      if (i === 0) note(t, dst, fold(chord[0]) + 12, { type: "triangle", vol: 0.26 * v, dur: sixteenth * 14 });
      if (bar === s.intro - 1) { // the bar before the drop: a snare roll that builds
        hat(t, dst, v * (0.5 + i / 16), "x");
        if (i >= 8) snare(t, dst, v * (0.3 + (i - 8) / 9), "x", i - 8);
      }
    } else {
      // drums: the section's beat, a fill in the last bar of every 4, a crash on each new section
      const lastOf4 = inSec % 4 === 3 && sec.drums !== "build" && sec.drums !== "none";
      const kit = lastOf4 ? s.fill : sec.drums === "half" ? HALF : sec.drums === "sparse" ? SPARSE : sec.drums === "none" ? null : s;
      const n = kit === s ? step : i; // 32-step breaks run over two bars
      if (inSec === 0 && i === 0 && sec.drums !== "build") crash(t, dst, v);
      if (sec.drums === "build") { // a roll: 8ths, then 16ths, rising, over a riser; the very last step is silent
        const q = (inSec + i / 16) / sec.bars, lastStep = inSec === sec.bars - 1 && i === 15;
        if (!lastStep && (q >= 0.5 || i % 2 === 0)) snare(t, dst, v * (0.3 + 0.6 * q), "x", Math.round(q * 9));
        if (i === 0 && inSec === 0) noiseHit(t, dst, { freq: 400, type: "highpass", vol: 0.08 * v, dur: sixteenth * 16 * sec.bars, sweep: 9000 });
        if (i % 4 === 0 && !lastStep) kick(t, dst, v * 0.7);
      } else if (kit) {
        const k = at(kit.kick, n), sn = at(kit.snare, n), hh = at(kit.hat, n);
        if (k !== ".") { // the kick, and the sub ducks a little under it
          kick(t, dst, v);
          const sc = s.bassGain.gain; sc.setValueAtTime(sc.value, t - 0.003); sc.linearRampToValueAtTime(0.55, t); sc.setTargetAtTime(1, t + 0.015, 0.025);
        }
        if (sn !== ".") snare(t, dst, v, sn);
        if (hh !== ".") hat(t, dst, v, hh);
      }
      // bass
      const b = at(s.bass, i);
      if (b !== "." && sec.drums !== "none") {
        const r = fold(chord[0]), up = b === "o" ? 12 : b === "f" ? 7 : b === "b" ? 10 : 0;
        note(t, dst, r + 12 + up, { type: 0.25, vol: 0.12 * v, dur: sixteenth * 1.8, cutoff: 1400, from: b === "s" ? r + 10 : null }); // the grit
        note(t, s.bassGain, r + (b === "f" ? 7 : 0), { type: "triangle", vol: 0.24 * v, dur: sixteenth * 1.8, from: b === "s" ? r - 2 : null }); // the sub
      }
      // lead: the song's tune, bar by bar ("call" plays only the first half of each bar)
      if (s.tune && sec.lead) {
        const line = s.tune[bar % 4], hit = line.find(([st]) => st === i);
        if (hit && !(sec.lead === "call" && i >= 8)) {
          const later = line.find(([st]) => st > i), len = Math.min(sixteenth * 3, ((later ? later[0] : 16) - i) * sixteenth * 0.9);
          const m = degreeNote(s, deg, hit[1]) + 24 + (sec.up || 0);
          note(t, dst, m, { type: s.leadDuty || 0.25, vol: 0.085 * v, dur: len, vibrato: len > 0.2 ? 20 : 0, cutoff: 5000 });
          if (s.echo) note(t + sixteenth * 3, dst, m, { type: s.leadDuty || 0.25, vol: 0.03 * v, dur: len * 0.8, cutoff: 3000 }); // the chip echo
          s.leadAt = step;
        }
      }
    }
    // arp: the section says on, off, or "gaps" (only where the lead rests: call and response)
    const leadNow = s.leadAt != null && step - s.leadAt <= 1;
    if (at(s.arp, i) !== "." && (intro || sec.arp === true || (sec.arp === "gaps" && !leadNow))) {
      const up = chord.map((n) => n + 24), order = i % 2 ? [up[2], up[1], up[0]] : up;
      const base = (s.arpVol ?? 0.05) * (s.arpDuty === 0.5 ? 0.7 : 1) * (leadNow ? 0.6 : 1);
      arp(t, dst, order, sixteenth, { duty: s.arpDuty, vol: (intro ? 0.03 + 0.02 * (bar + i / 16) : base) * v });
    }
    if (s.pad && i === 0) { // soft held chord (a narrow pulse, filtered); add9 on the calm songs
      const tones = s.add9 ? [...chord, degreeNote(s, deg, 1) + 12] : chord;
      for (const n of tones) note(t, dst, n + 12, { type: 0.25, vol: 0.018 * s.pad * v * (intro ? 2 : 1), dur: sixteenth * 14, attack: sixteenth * 3, cutoff: 1800 });
    }
  }
  function schedule() {
    if (!song || ac.state !== "running") return;
    const ahead = ac.currentTime + 0.12, sixteenth = 60 / song.bpm / 4;
    if (next < ac.currentTime - 0.25) next = ac.currentTime + 0.02; // fell behind (a throttled tab): skip ahead
    while (next < ahead) {
      playStep(next);
      next += sixteenth;
      if (++step % 16 === 0) bar++;
    }
  }

  return {
    // start a song (or keep the one that's playing if it's the same)
    play(which, seed = "", kind = "") {
      const key = `${which}:${seed}:${kind}`;
      if (key === seedKey && song) return;
      const make = SONGS[which];
      if (!make) return;
      if (songGain) { // crossfade: fade the old one out
        const old = songGain, t = ac.currentTime;
        old.gain.setValueAtTime(old.gain.value, t); old.gain.linearRampToValueAtTime(0.0001, t + 0.6);
        setTimeout(() => old.disconnect(), 900);
      }
      song = make(seed, kind); name = which; seedKey = key; step = 0; bar = 0; section = "main";
      song.fill = FILLS[hash(`${which}${seed}`) % FILLS.length];
      if (song.lead) song.tune = melody(song.leadSeed || hash(seed) || 1, song.lead);
      songGain = ac.createGain(); songGain.connect(bus);
      song.bassGain = ac.createGain(); song.bassGain.connect(songGain);
      songGain.gain.setValueAtTime(0.0001, ac.currentTime); songGain.gain.linearRampToValueAtTime(1, ac.currentTime + 0.4);
      next = ac.currentTime + 0.05;
      timer ??= setInterval(schedule, 25);
      schedule();
    },
    // the trailer's ending: stop the groove, one last chord on the next step
    outro() {
      if (!song) return;
      section = "outro"; song.outroDone = false;
    },
    stop() {
      if (songGain) { const old = songGain; old.gain.setTargetAtTime(0.0001, ac.currentTime, 0.15); setTimeout(() => old.disconnect(), 800); }
      song = null; songGain = null; name = null; seedKey = null;
    },
    duck(down) { bus.gain.setTargetAtTime(down ? 0.25 : 1, ac.currentTime, 0.1); },
    // a quick dip under an important sound effect (depth as a gain, 0.5 = -6 dB)
    dip(ms = 250, depth = 0.5) {
      const t = ac.currentTime, g = dipper.gain;
      g.cancelScheduledValues(t); g.setTargetAtTime(depth, t, 0.015); g.setTargetAtTime(1, t + ms / 1000, 0.08);
    },
    get playing() { return name; },
  };
}
