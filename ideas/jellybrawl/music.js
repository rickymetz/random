// Synthesised music (WebAudio): a small 16-step sequencer with drums, bass,
// an arpeggio and pads. No files. One song per part of the night; changing
// song crossfades. Songs are data (patterns + a chord progression), so a
// game can get its own tempo and key from a seed.
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

// x = hit, o = accent (louder / open hat / longer note), . = rest
const SONGS = {
  lobby: () => ({
    bpm: 96, root: 45, scale: MINOR, prog: [0, 5, 2, 6], vol: 0.8,
    kick: "x.........x.....", snare: "....x.......x...", hat: "..x...x...x...o.",
    bass: "x.....x.x.....x.", arp: "x..x..x..x..x.x.", arpOct: 1, pad: 1, lead: null,
  }),
  game: (seed) => {
    const h = hash(seed);
    return {
      bpm: 124 + (h % 6) * 4, root: [45, 47, 48, 50, 52][(h >>> 3) % 5], scale: MINOR,
      prog: [[0, 5, 2, 6], [0, 6, 5, 4], [0, 3, 5, 4], [5, 6, 0, 0]][(h >>> 6) % 4], vol: 1,
      kick: "x...x...x...x...", snare: "....x.......x...", hat: ["..x...x...x...x.", "x.x.x.x.x.x.x.xo", ".xx..xx..xx..xxo"][(h >>> 8) % 3],
      bass: ["..x...x...x...x.", "x.xx..x.x.xx..x.", "xoxoxoxoxoxoxoxo"][(h >>> 10) % 3],
      arp: "xxxxxxxxxxxxxxxx", arpOct: 2, pad: 0.6, lead: null,
    };
  },
  board: () => ({
    bpm: 112, root: 48, scale: MAJOR, prog: [0, 4, 5, 3], vol: 1.1,
    kick: "x.....x...x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.",
    bass: "x..x..x.x..x..x.", arp: "x.x.x.x.x.x.x.x.", arpOct: 2, pad: 0.8, lead: null,
  }),
  final: () => ({
    bpm: 104, root: 48, scale: MAJOR, prog: [0, 3, 4, 0], vol: 0.9,
    kick: "x.......x.x.....", snare: "....o.......o...", hat: "x.x.x.x.x.x.x.x.",
    bass: "x...x...x...x...", arp: "x.x.x.x.x.x.x.x.", arpOct: 2, pad: 1, lead: [0, 2, 4, 7],
  }),
  // the sizzle: one bar = 1.4 s, so every cut lands on a downbeat; half-time drums
  trailer: () => ({
    bpm: 1200 / 7, root: 45, scale: MINOR, prog: [0, 5, 2, 6], vol: 1, intro: 2,
    kick: "x.......x.x.....", snare: "........o.......", hat: "x.x.x.x.x.x.x.xo",
    bass: "x.xx.x.xx.xx.x.x", arp: "xxxxxxxxxxxxxxxx", arpOct: 2, pad: 0.8, lead: null,
  }),
};

export function createMusic(ac, out) {
  let noiseBuf = null;
  function noiseBuffer() {
    if (noiseBuf) return noiseBuf;
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  const bus = ac.createGain(); // ducking for pause
  bus.connect(out);

  let song = null, songGain = null, name = null, seedKey = null, step = 0, bar = 0, next = 0, section = "main";
  let timer = null;

  // ------------------------------------------------------------ instruments
  function env(g, t, peak, a, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function kick(t, dst, v) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    env(g, t, 0.9 * v, 0.004, 0.3);
    o.connect(g).connect(dst); o.start(t); o.stop(t + 0.35);
  }
  function noiseHit(t, dst, { freq, type, q = 1, vol, dur }) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuffer(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    env(g, t, vol, 0.002, dur);
    s.connect(f).connect(g).connect(dst);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  function snare(t, dst, v, accent) {
    noiseHit(t, dst, { freq: 1800, type: "bandpass", q: 0.8, vol: (accent ? 0.5 : 0.35) * v, dur: accent ? 0.28 : 0.16 });
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    env(g, t, 0.25 * v, 0.002, 0.09);
    o.connect(g).connect(dst); o.start(t); o.stop(t + 0.12);
  }
  function hat(t, dst, v, open) {
    noiseHit(t, dst, { freq: 7500, type: "highpass", vol: (open ? 0.12 : 0.07) * v, dur: open ? 0.16 : 0.035 });
  }
  function synth(t, dst, midi, { type, cutoff, vol, dur, detune = 0, attack = 0.005, q = 2 }) {
    const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = type; o.frequency.value = hz(midi); o.detune.value = detune;
    f.type = "lowpass"; f.Q.value = q;
    f.frequency.setValueAtTime(cutoff * 2.2, t); f.frequency.exponentialRampToValueAtTime(cutoff, t + Math.min(dur, 0.2));
    env(g, t, vol, attack, dur);
    o.connect(f).connect(g).connect(dst); o.start(t); o.stop(t + attack + dur + 0.05);
  }

  // ------------------------------------------------------------ the sequencer
  const on = (pat, i) => pat && pat[i % pat.length] !== ".";
  const accent = (pat, i) => pat && pat[i % pat.length] === "o";
  function chordNotes(s, deg) { // a triad on a scale degree, as midi notes
    const n = (k) => s.root + s.scale[(deg + k) % 7] + 12 * Math.floor((deg + k) / 7);
    return [n(0), n(2), n(4)];
  }
  function playStep(t) {
    const s = song, dst = songGain, i = step % 16, v = s.vol;
    const deg = s.prog[bar % s.prog.length], chord = chordNotes(s, deg), sixteenth = 60 / s.bpm / 4;
    const intro = s.intro && bar < s.intro, outro = section === "outro";
    if (outro) {
      if (!s.outroDone) { // one last big chord and a crash, on the next step
        s.outroDone = true;
        const home = chordNotes(s, s.prog[0]);
        kick(t, dst, v * 1.2); snare(t, dst, v, true); noiseHit(t, dst, { freq: 5000, type: "highpass", vol: 0.3 * v, dur: 2 });
        for (const n of home) for (const d of [-8, 8]) synth(t, dst, n + 12, { type: "sawtooth", cutoff: 2400, vol: 0.075 * v, dur: 7, detune: d, attack: 0.02, q: 1 });
        synth(t, dst, home[0] + 24, { type: "square", cutoff: 3000, vol: 0.05 * v, dur: 5 });
        synth(t, dst, home[0] - 12, { type: "sawtooth", cutoff: 600, vol: 0.25 * v, dur: 7 });
      }
      return;
    }
    if (intro && bar === s.intro - 1) { // the bar before the drop: a snare and hat build
      hat(t, dst, v * (0.4 + i / 16), false);
      if (i >= 8) snare(t, dst, v * (0.3 + (i - 8) / 10), false);
    }
    if (!intro) {
      if (on(s.kick, i)) kick(t, dst, v);
      if (on(s.snare, i)) snare(t, dst, v, accent(s.snare, i));
      if (on(s.hat, i)) hat(t, dst, v, accent(s.hat, i));
      if (on(s.bass, i)) {
        const oct = accent(s.bass, i) ? 12 : 0;
        synth(t, dst, chord[0] - 12 + oct, { type: "sawtooth", cutoff: 520, vol: 0.2 * v, dur: sixteenth * 1.6, q: 4 });
      }
    } else if (i === 0) { hat(t, dst, v, true); synth(t, dst, chord[0] - 12, { type: "sawtooth", cutoff: 420, vol: 0.3 * v, dur: 60 / s.bpm * 6, q: 1 }); }
    if (on(s.arp, i)) { // up and down the chord, an octave or two up
      const order = [0, 1, 2, 1], n = chord[order[i % 4]] + 12 * (s.arpOct - (i % 8 < 4 ? 0 : 1)) + 12;
      synth(t, dst, n, { type: "square", cutoff: intro ? 1600 + 900 * (bar + i / 16) : 2600, vol: (intro ? 0.05 : 0.045) * v, dur: sixteenth * 0.9 });
    }
    if (s.lead && i % 4 === 0) {
      const n = chord[0] + 24 + s.lead[(bar * 4 + i / 4) % s.lead.length];
      synth(t, dst, n, { type: "triangle", cutoff: 3000, vol: 0.06 * v, dur: sixteenth * 3.5 });
    }
    if (s.pad && i === 0) {
      const len = sixteenth * 16;
      for (const n of chord) for (const d of [-9, 9])
        synth(t, dst, n + 12, { type: "sawtooth", cutoff: 900, vol: 0.022 * s.pad * v * (intro ? 2 : 1), dur: len * 0.8, detune: d, attack: len * 0.18, q: 1 });
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
    // the trailer's ending: stop the groove, one last chord on the next downbeat
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
