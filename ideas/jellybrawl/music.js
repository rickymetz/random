// Synthesised music (WebAudio): chiptune drum & bass. No files.
//
// An 8-bit band on a 16-step sequencer: pulse-wave leads (12.5% / 25% duty,
// with vibrato), chip chord arpeggios (the chord cycled every 32nd, the old
// way of faking polyphony), a pulse bass with a sub under it, and
// noise-channel drums playing two-step breakbeats at drum & bass tempos.
// One song per part of the night; changing song crossfades. Songs are data
// (patterns + a chord progression), so each game gets its own tempo, key,
// beat and melody from a seed.
//
//   const m = createMusic(audioContext, outputNode);
//   m.play("game", "sumo");  m.duck(true);  m.stop();
//
// The scheduler looks ahead on the AudioContext clock, so a suspended
// context (the sizzle recorder pauses its own) simply stops the music in
// place and it carries on, in time, when the context resumes.

const MINOR = [0, 2, 3, 5, 7, 8, 10], MAJOR = [0, 2, 4, 5, 7, 9, 11];
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const pick = (list, h, shift) => list[(h >>> shift) % list.length];
function rng(seed) { let a = seed >>> 0 || 1; return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; }; }

// Drums: x = hit, o = accent, g = ghost (quiet), . = rest. 16 steps a bar.
const BEATS = [
  { kick: "x.........x.....", snare: "....o......go...", hat: "x.xgx.xgx.xgx.xg" }, // two-step
  { kick: "x.x.......x.....", snare: "....o..g....o..g", hat: "x.x.x.x.x.x.x.x." }, // with a skip
  { kick: "x.........xx....", snare: "....o.g.....o.g.", hat: "xgxgxgxgxgxgxgxg" }, // rolling
  { kick: "x......x..x.....", snare: "....o.......o.gg", hat: "x.x.xgx.x.x.xgx." }, // amen-ish
];
// Bass: x = root, o = octave up, f = the fifth, . = rest
const BASSES = ["x..x..x...x..o..", "x.......x.x..o..", "xo..xo..x.o.x...", "x..x..f.x..x..o."];
// Lead rhythms (x = a note); pitches come from a seeded walk over the chord
const LEADS = ["x..x..x.x.x.x...", "x.x...x.x...x.xx", "x...x.x...x.x.x.", "xx..x..xx..x.x.."];

const SONGS = {
  // a liquid groove: half the drums, no lead, soft arps
  lobby: () => ({
    bpm: 170, root: 45, scale: MINOR, prog: [0, 5, 2, 6], vol: 0.75, lead: null, pad: 1, arp: "x.x.x.x.x.x.x.x.", arpDuty: 0.25,
    kick: "x.........x.....", snare: "....x.......x...", hat: "..x...x...x...x.", bass: "x.......x.......",
  }),
  game: (seed) => {
    const h = hash(seed), beat = pick(BEATS, h, 8);
    return {
      bpm: 172 + (h % 3) * 2, root: pick([45, 47, 48, 50, 52], h, 3), scale: MINOR,
      prog: pick([[0, 5, 2, 6], [0, 6, 5, 4], [0, 3, 5, 4], [5, 6, 0, 0], [0, 0, 5, 6]], h, 5), vol: 1,
      ...beat, bass: pick(BASSES, h, 11), lead: pick(LEADS, h, 14), leadSeed: h, pad: 0.5,
      arp: "xxxxxxxxxxxxxxxx", arpDuty: 0.5,
    };
  },
  board: () => ({
    bpm: 170, root: 48, scale: MAJOR, prog: [0, 4, 5, 3], vol: 0.95, ...BEATS[1],
    bass: "x..x..f.x..x..o.", lead: "x.x...x.x...x.xx", leadSeed: 7, pad: 0.6, arp: "x.x.x.x.x.x.x.x.", arpDuty: 0.25,
  }),
  final: () => ({
    bpm: 174, root: 48, scale: MAJOR, prog: [0, 3, 4, 5], vol: 1, ...BEATS[0],
    bass: "x..x..x...x..o..", lead: "x..x..x.x.x.x...", leadSeed: 3, pad: 1, arp: "xxxxxxxxxxxxxxxx", arpDuty: 0.5,
  }),
  // the sizzle: one bar = 1.4 s, so every cut lands on a downbeat
  trailer: () => ({
    bpm: 1200 / 7, root: 45, scale: MINOR, prog: [0, 5, 2, 6], vol: 1, intro: 2, ...BEATS[2],
    bass: "xo..xo..x.o.x...", lead: "x..x..x.x.x.x...", leadSeed: 11, pad: 0.6, arp: "xxxxxxxxxxxxxxxx", arpDuty: 0.5,
  }),
};

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
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < d.length; i++) { if (i % 3 === 0) v = Math.random() * 2 - 1; d[i] = v; }
    return noiseBuf;
  }
  const bus = ac.createGain(); // ducking for pause
  bus.connect(out);

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
  function noiseHit(t, dst, { freq, type, q = 1, vol, dur }) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuffer(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    env(g, t, vol, 0.001, dur);
    s.connect(f).connect(g).connect(dst);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  function kick(t, dst, v) {
    const o = osc("triangle"), g = ac.createGain();
    o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.09);
    env(g, t, 1.1 * v, 0.002, 0.22);
    o.connect(g).connect(dst); o.start(t); o.stop(t + 0.3);
    noiseHit(t, dst, { freq: 2500, type: "lowpass", vol: 0.25 * v, dur: 0.015 }); // the click
  }
  function snare(t, dst, v, kind) {
    const vol = kind === "o" ? 0.55 : kind === "g" ? 0.14 : 0.4;
    noiseHit(t, dst, { freq: 3000, type: "bandpass", q: 0.6, vol: vol * v, dur: kind === "g" ? 0.05 : 0.15 });
    const o = osc(0.5), g = ac.createGain(); // a pitched body under the noise
    o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.06);
    env(g, t, vol * 0.35 * v, 0.001, 0.06);
    o.connect(g).connect(dst); o.start(t); o.stop(t + 0.1);
  }
  function hat(t, dst, v, kind) {
    noiseHit(t, dst, { freq: 9000, type: "highpass", vol: (kind === "o" ? 0.12 : kind === "g" ? 0.03 : 0.06) * v, dur: kind === "o" ? 0.12 : 0.025 });
  }
  function note(t, dst, midi, { type, vol, dur, cutoff = 6000, attack = 0.003, vibrato = 0 }) {
    const o = osc(type), g = ac.createGain(), f = ac.createBiquadFilter();
    o.frequency.value = hz(midi);
    f.type = "lowpass"; f.frequency.value = cutoff;
    if (vibrato) { // delayed vibrato, the classic chip lead
      const lfo = ac.createOscillator(), depth = ac.createGain();
      lfo.frequency.value = 6; depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(vibrato, t + Math.min(0.25, dur * 0.6));
      lfo.connect(depth).connect(o.detune); lfo.start(t); lfo.stop(t + attack + dur + 0.05);
    }
    env(g, t, vol, attack, dur);
    o.connect(f).connect(g).connect(dst); o.start(t); o.stop(t + attack + dur + 0.05);
  }
  // one 16th of arpeggio: the chord's three notes cycled inside it (32nd triplets)
  function arp(t, dst, notes, len, { duty, vol }) {
    const o = osc(duty), g = ac.createGain(), slice = len / 3;
    notes.forEach((n, k) => o.frequency.setValueAtTime(hz(n), t + k * slice));
    env(g, t, vol, 0.002, len * 0.95);
    o.connect(g).connect(dst); o.start(t); o.stop(t + len + 0.03);
  }

  // ------------------------------------------------------------ the sequencer
  const at = (pat, i) => (pat ? pat[i % pat.length] : ".");
  function chordNotes(s, deg) { // a triad on a scale degree, as midi notes
    const n = (k) => s.root + s.scale[(deg + k) % 7] + 12 * Math.floor((deg + k) / 7);
    return [n(0), n(2), n(4)];
  }
  // the lead's pitch for a step: a seeded walk over the chord, repeating every 4 bars
  function leadNote(s, chord, i) {
    const r = rng((s.leadSeed || 1) * 131 + (bar % 4) * 17 + i);
    const tones = [chord[0], chord[1], chord[2], chord[0] + 12, chord[1] + 12];
    return tones[Math.floor(r() * tones.length)] + 24;
  }
  function playStep(t) {
    const s = song, dst = songGain, i = step % 16, v = s.vol;
    const deg = s.prog[bar % s.prog.length], chord = chordNotes(s, deg), sixteenth = 60 / s.bpm / 4;
    const intro = s.intro && bar < s.intro;
    if (section === "outro") {
      if (!s.outroDone) { // one last big chord and a crash, on the next step
        s.outroDone = true;
        const home = chordNotes(s, s.prog[0]);
        kick(t, dst, v * 1.2); snare(t, dst, v, "o"); noiseHit(t, dst, { freq: 6000, type: "highpass", vol: 0.28 * v, dur: 2 });
        for (const n of home) note(t, dst, n + 12, { type: 0.5, vol: 0.06 * v, dur: 6, attack: 0.01 });
        note(t, dst, home[0] + 24, { type: 0.125, vol: 0.07 * v, dur: 5, vibrato: 25 });
        note(t, dst, home[0] - 12, { type: "triangle", vol: 0.35 * v, dur: 6 });
      }
      return;
    }
    if (intro) {
      if (i === 0) note(t, dst, chord[0] - 12, { type: "triangle", vol: 0.3 * v, dur: sixteenth * 14 });
      if (bar === s.intro - 1) { // the bar before the drop: a snare roll that builds
        hat(t, dst, v * (0.5 + i / 16), "x");
        if (i >= 8) snare(t, dst, v * (0.3 + (i - 8) / 9), "x");
      }
    } else {
      const k = at(s.kick, i), sn = at(s.snare, i), hh = at(s.hat, i), b = at(s.bass, i);
      if (k !== ".") kick(t, dst, v);
      if (sn !== ".") snare(t, dst, v, sn);
      if (hh !== ".") hat(t, dst, v, hh);
      if (b !== ".") {
        const n = chord[0] - 12 + (b === "o" ? 12 : b === "f" ? 7 : 0);
        note(t, dst, n, { type: 0.25, vol: 0.12 * v, dur: sixteenth * 1.8, cutoff: 1400 }); // the grit
        note(t, dst, n - 12, { type: "triangle", vol: 0.3 * v, dur: sixteenth * 1.8 }); // the sub
      }
      if (at(s.lead, i) === "x") {
        const len = at(s.lead, i + 1) === "." ? sixteenth * 2.6 : sixteenth * 0.9;
        note(t, dst, leadNote(s, chord, i), { type: 0.125, vol: 0.07 * v, dur: len, vibrato: len > 0.2 ? 20 : 0 });
      }
    }
    if (at(s.arp, i) !== ".") {
      const up = chord.map((n) => n + 24), order = i % 2 ? [up[2], up[1], up[0]] : up;
      arp(t, dst, order, sixteenth, { duty: s.arpDuty, vol: (intro ? 0.03 + 0.02 * (bar + i / 16) : 0.035) * v });
    }
    if (s.pad && i === 0) { // soft held chord (a narrow pulse, filtered)
      for (const n of chord) note(t, dst, n + 12, { type: 0.25, vol: 0.018 * s.pad * v * (intro ? 2 : 1), dur: sixteenth * 14, attack: sixteenth * 3, cutoff: 1800 });
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
    play(which, seed = "") {
      const key = `${which}:${seed}`;
      if (key === seedKey && song) return;
      const make = SONGS[which];
      if (!make) return;
      if (songGain) { // crossfade: fade the old one out
        const old = songGain, t = ac.currentTime;
        old.gain.setValueAtTime(old.gain.value, t); old.gain.linearRampToValueAtTime(0.0001, t + 0.6);
        setTimeout(() => old.disconnect(), 900);
      }
      song = make(seed); name = which; seedKey = key; step = 0; bar = 0; section = "main";
      songGain = ac.createGain(); songGain.connect(bus);
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
    get playing() { return name; },
  };
}
