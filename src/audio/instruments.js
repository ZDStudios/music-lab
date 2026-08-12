/*
 * Every sound here is synthesised from oscillators and noise, so the app has
 * zero audio assets: it loads instantly and works with no network at all.
 */

const noiseCache = new WeakMap();

export function noiseBuffer(ctx) {
  let buf = noiseCache.get(ctx);
  if (buf) return buf;
  const len = Math.floor(ctx.sampleRate * 2);
  buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

function noiseSource(ctx, time, dur) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  src.playbackRate.value = 0.85 + Math.random() * 0.3;
  const offset = Math.random() * 1.5;
  src.start(time, offset);
  src.stop(time + dur + 0.02);
  return src;
}

/** Linear attack, exponential-ish decay to a sustain, then release. */
function adsr(param, time, dur, { a = 0.005, d = 0.1, s = 0, r = 0.08, peak = 1 }) {
  const hold = Math.max(dur, a + 0.01);
  param.setValueAtTime(0.0001, time);
  param.linearRampToValueAtTime(peak, time + a);
  if (s > 0) {
    param.setTargetAtTime(peak * s, time + a, Math.max(0.008, d / 3));
    param.setValueAtTime(Math.max(0.0001, peak * s), time + hold);
    param.setTargetAtTime(0.0001, time + hold, Math.max(0.01, r / 3));
    return time + hold + r + 0.05;
  }
  // Percussive: one decay to silence, ignoring the written length.
  param.setTargetAtTime(0.0001, time + a, Math.max(0.01, d / 3.2));
  return time + a + d * 1.6 + 0.05;
}

function osc(ctx, type, freq, time, detuneCents = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (detuneCents) o.detune.value = detuneCents;
  return o;
}

function lfo(ctx, rate, depth, target, time, end) {
  const o = ctx.createOscillator();
  o.frequency.value = rate;
  const g = ctx.createGain();
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start(time);
  o.stop(end);
}

/* ------------------------------------------------------------------ *
 * Melodic voices
 * ------------------------------------------------------------------ */

const VOICES = {
  marimba(ctx, out, f, time, dur, vel) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(9000, f * 8 + 1200);
    const decay = Math.max(0.22, 0.75 - f / 2200);
    const end = adsr(g.gain, time, dur, { a: 0.002, d: decay, peak: 0.5 * vel });
    const o1 = osc(ctx, 'sine', f, time);
    const o2 = osc(ctx, 'sine', f * 4.02, time);
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    adsr(g2.gain, time, dur, { a: 0.001, d: 0.06, peak: 0.2 * vel });
    o1.connect(g); o2.connect(g2).connect(g);
    g.connect(lp).connect(out);
    [o1, o2].forEach((o) => { o.start(time); o.stop(end); });
    return end;
  },

  piano(ctx, out, f, time, dur, vel) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(11000, f * 9 + 2500), time);
    lp.frequency.setTargetAtTime(Math.max(500, f * 2.4), time + 0.02, 0.25);
    const decay = Math.max(0.5, 2.4 - f / 900);
    const end = adsr(g.gain, time, dur, { a: 0.004, d: decay, s: dur > 0.35 ? 0.12 : 0, r: 0.28, peak: 0.42 * vel });
    const o1 = osc(ctx, 'triangle', f, time);
    const o2 = osc(ctx, 'sawtooth', f, time, 6);
    const o3 = osc(ctx, 'sine', f * 2, time);
    const mix = ctx.createGain(); mix.gain.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.22;
    const g3 = ctx.createGain(); g3.gain.value = 0.16;
    o1.connect(mix); o2.connect(g2).connect(mix); o3.connect(g3).connect(mix);
    mix.connect(g).connect(lp).connect(out);
    [o1, o2, o3].forEach((o) => { o.start(time); o.stop(end); });
    return end;
  },

  musicbox(ctx, out, f, time, dur, vel) {
    const g = ctx.createGain();
    const end = adsr(g.gain, time, dur, { a: 0.002, d: Math.max(0.5, 1.8 - f / 1500), peak: 0.34 * vel });
    const carrier = osc(ctx, 'sine', f, time);
    const mod = osc(ctx, 'sine', f * 3.51, time);
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(f * 2.2 * vel, time);
    modGain.gain.setTargetAtTime(0, time, 0.045);
    mod.connect(modGain).connect(carrier.frequency);
    const shimmer = osc(ctx, 'sine', f * 5.03, time);
    const sg = ctx.createGain(); sg.gain.value = 0.08;
    carrier.connect(g); shimmer.connect(sg).connect(g);
    g.connect(out);
    [carrier, mod, shimmer].forEach((o) => { o.start(time); o.stop(end); });
    return end;
  },

  pluck(ctx, out, f, time, dur, vel) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(Math.min(12000, f * 12), time);
    lp.frequency.setTargetAtTime(Math.max(320, f * 1.6), time + 0.005, 0.09);
    const end = adsr(g.gain, time, dur, { a: 0.003, d: Math.max(0.3, 1.1 - f / 1600), peak: 0.34 * vel });
    const o1 = osc(ctx, 'sawtooth', f, time);
    const o2 = osc(ctx, 'triangle', f, time, -9);
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    o1.connect(g); o2.connect(g2).connect(g);
    g.connect(lp).connect(out);
    [o1, o2].forEach((o) => { o.start(time); o.stop(end); });
    return end;
  },

  strings(ctx, out, f, time, dur, vel) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(6000, f * 6 + 900);
    const end = adsr(g.gain, time, dur, { a: 0.14, d: 0.2, s: 0.85, r: 0.4, peak: 0.26 * vel });
    const o1 = osc(ctx, 'sawtooth', f, time, -7);
    const o2 = osc(ctx, 'sawtooth', f, time, 8);
    const o3 = osc(ctx, 'triangle', f * 0.5, time);
    const g3 = ctx.createGain(); g3.gain.value = 0.3;
    o1.connect(g); o2.connect(g); o3.connect(g3).connect(g);
    g.connect(lp).connect(out);
    lfo(ctx, 5.2, f * 0.006, o1.frequency, time, end);
    [o1, o2, o3].forEach((o) => { o.start(time); o.stop(end); });
    return end;
  },

  brass(ctx, out, f, time, dur, vel) {
    const g = ctx.createGain();
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(Math.max(300, f * 1.2), time);
    bp.frequency.linearRampToValueAtTime(Math.min(7000, f * 6), time + 0.09);
    const end = adsr(g.gain, time, dur, { a: 0.05, d: 0.15, s: 0.78, r: 0.16, peak: 0.24 * vel });
    const o1 = osc(ctx, 'sawtooth', f, time);
    const o2 = osc(ctx, 'square', f, time, 5);
    const g2 = ctx.createGain(); g2.gain.value = 0.28;
    o1.connect(g); o2.connect(g2).connect(g);
    g.connect(bp).connect(out);
    [o1, o2].forEach((o) => { o.start(time); o.stop(end); });
    return end;
  },

  flute(ctx, out, f, time, dur, vel) {
    const g = ctx.createGain();
    const end = adsr(g.gain, time, dur, { a: 0.07, d: 0.1, s: 0.85, r: 0.16, peak: 0.3 * vel });
    const o1 = osc(ctx, 'sine', f, time);
    const o2 = osc(ctx, 'sine', f * 2, time);
    const g2 = ctx.createGain(); g2.gain.value = 0.1;
    const breath = noiseSource(ctx, time, end - time);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 1.4;
    const bg = ctx.createGain(); bg.gain.value = 0.05 * vel;
    breath.connect(bp).connect(bg).connect(g);
    o1.connect(g); o2.connect(g2).connect(g);
    g.connect(out);
    lfo(ctx, 4.6, f * 0.005, o1.frequency, time, end);
    [o1, o2].forEach((o) => { o.start(time); o.stop(end); });
    return end;
  },

  organ(ctx, out, f, time, dur, vel) {
    const g = ctx.createGain();
    const end = adsr(g.gain, time, dur, { a: 0.012, d: 0.05, s: 0.95, r: 0.07, peak: 0.2 * vel });
    const parts = [[1, 1], [2, 0.5], [3, 0.28], [4, 0.2], [6, 0.12], [8, 0.08]];
    const oscs = parts.map(([mult, amp]) => {
      const o = osc(ctx, 'sine', f * mult, time);
      const gg = ctx.createGain(); gg.gain.value = amp;
      o.connect(gg).connect(g);
      return o;
    });
    g.connect(out);
    oscs.forEach((o) => { o.start(time); o.stop(end); });
    return end;
  },

  lead(ctx, out, f, time, dur, vel) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(Math.min(9000, f * 8), time);
    lp.frequency.setTargetAtTime(Math.max(600, f * 3), time + 0.02, 0.12);
    const end = adsr(g.gain, time, dur, { a: 0.008, d: 0.12, s: 0.72, r: 0.12, peak: 0.24 * vel });
    const o1 = osc(ctx, 'sawtooth', f, time, -8);
    const o2 = osc(ctx, 'square', f, time, 9);
    const g2 = ctx.createGain(); g2.gain.value = 0.45;
    o1.connect(g); o2.connect(g2).connect(g);
    g.connect(lp).connect(out);
    [o1, o2].forEach((o) => { o.start(time); o.stop(end); });
    return end;
  },

  pad(ctx, out, f, time, dur, vel) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = Math.min(4200, f * 5 + 700);
    const end = adsr(g.gain, time, dur, { a: 0.35, d: 0.3, s: 0.9, r: 0.9, peak: 0.19 * vel });
    const dets = [-12, 0, 11, 24];
    const oscs = dets.map((d, i) => {
      const o = osc(ctx, i === 3 ? 'triangle' : 'sawtooth', f * (i === 3 ? 0.5 : 1), time, d);
      const gg = ctx.createGain(); gg.gain.value = i === 3 ? 0.4 : 0.34;
      o.connect(gg).connect(g);
      return o;
    });
    g.connect(lp).connect(out);
    lfo(ctx, 0.22, 400, lp.frequency, time, end);
    oscs.forEach((o) => { o.start(time); o.stop(end); });
    return end;
  },

  bass(ctx, out, f, time, dur, vel) {
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(Math.min(3200, f * 9 + 300), time);
    lp.frequency.setTargetAtTime(Math.max(140, f * 2.2), time + 0.01, 0.12);
    const end = adsr(g.gain, time, dur, { a: 0.006, d: 0.14, s: 0.7, r: 0.1, peak: 0.55 * vel });
    const o1 = osc(ctx, 'sine', f, time);
    const o2 = osc(ctx, 'square', f, time, 4);
    const g2 = ctx.createGain(); g2.gain.value = 0.22;
    o1.connect(g); o2.connect(g2).connect(g);
    g.connect(lp).connect(out);
    [o1, o2].forEach((o) => { o.start(time); o.stop(end); });
    return end;
  },
};

export function playMelody(ctx, out, instrument, freq, time, dur, vel = 0.85) {
  const voice = VOICES[instrument] || VOICES.marimba;
  return voice(ctx, out, freq, time, Math.max(0.05, dur), Math.max(0.05, vel));
}

/* ------------------------------------------------------------------ *
 * Percussion
 * ------------------------------------------------------------------ */

function tone(ctx, out, time, { f0, f1, dur, wave = 'sine', gain = 1, curve = 'exp' }) {
  const o = osc(ctx, wave, f0, time);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, time);
  g.gain.setTargetAtTime(0.0001, time, Math.max(0.006, dur / 3.4));
  if (f1 != null && f1 !== f0) {
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), time + dur * 0.8);
    else o.frequency.linearRampToValueAtTime(Math.max(20, f1), time + dur * 0.8);
  }
  o.connect(g).connect(out);
  o.start(time);
  o.stop(time + dur * 1.8 + 0.03);
  return time + dur * 1.8 + 0.03;
}

function noiseHit(ctx, out, time, { type = 'highpass', freq = 6000, q = 0.8, dur = 0.08, gain = 0.5, sweep = 0 }) {
  const src = noiseSource(ctx, time, dur * 2);
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), time + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, time);
  g.gain.setTargetAtTime(0.0001, time, Math.max(0.005, dur / 3.4));
  src.connect(f).connect(g).connect(out);
  return time + dur * 2;
}

function clap(ctx, out, time, gain) {
  for (let i = 0; i < 3; i++) {
    noiseHit(ctx, out, time + i * 0.011, { type: 'bandpass', freq: 1500, q: 1.3, dur: 0.035, gain: gain * (1 - i * 0.2) });
  }
  return noiseHit(ctx, out, time + 0.03, { type: 'bandpass', freq: 1100, q: 1.1, dur: 0.16, gain: gain * 0.55 });
}

function metal(ctx, out, time, { base = 540, dur = 0.3, gain = 0.3 }) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, time);
  g.gain.setTargetAtTime(0.0001, time, dur / 3.2);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = base * 1.6; bp.Q.value = 2.2;
  const o1 = osc(ctx, 'square', base, time);
  const o2 = osc(ctx, 'square', base * 1.4983, time);
  o1.connect(bp); o2.connect(bp); bp.connect(g).connect(out);
  const end = time + dur * 1.7 + 0.03;
  [o1, o2].forEach((o) => { o.start(time); o.stop(end); });
  return end;
}

/* piece index → synth, per kit. Index order matches DRUM_KITS in project.js. */
const KIT_VOICES = {
  electronic: [
    (c, o, t, v) => { tone(c, o, t, { f0: 140, f1: 44, dur: 0.42, gain: 0.95 * v }); return noiseHit(c, o, t, { freq: 2500, dur: 0.012, gain: 0.18 * v }); },
    (c, o, t, v) => { tone(c, o, t, { f0: 210, f1: 170, dur: 0.1, wave: 'triangle', gain: 0.35 * v }); return noiseHit(c, o, t, { type: 'highpass', freq: 1700, dur: 0.17, gain: 0.5 * v }); },
    (c, o, t, v) => clap(c, o, t, 0.45 * v),
    (c, o, t, v) => noiseHit(c, o, t, { type: 'highpass', freq: 8500, dur: 0.04, gain: 0.34 * v }),
    (c, o, t, v) => noiseHit(c, o, t, { type: 'highpass', freq: 7000, dur: 0.34, gain: 0.28 * v }),
    (c, o, t, v) => tone(c, o, t, { f0: 260, f1: 95, dur: 0.3, wave: 'sine', gain: 0.6 * v }),
  ],
  acoustic: [
    (c, o, t, v) => { tone(c, o, t, { f0: 105, f1: 48, dur: 0.3, gain: 0.9 * v }); return noiseHit(c, o, t, { type: 'bandpass', freq: 900, q: 0.7, dur: 0.03, gain: 0.3 * v }); },
    (c, o, t, v) => { tone(c, o, t, { f0: 190, f1: 165, dur: 0.09, wave: 'triangle', gain: 0.3 * v }); return noiseHit(c, o, t, { type: 'bandpass', freq: 2200, q: 0.5, dur: 0.22, gain: 0.55 * v }); },
    (c, o, t, v) => { tone(c, o, t, { f0: 420, f1: 400, dur: 0.04, wave: 'triangle', gain: 0.3 * v }); return noiseHit(c, o, t, { type: 'bandpass', freq: 1800, q: 2, dur: 0.05, gain: 0.4 * v }); },
    (c, o, t, v) => noiseHit(c, o, t, { type: 'highpass', freq: 9000, dur: 0.05, gain: 0.3 * v }),
    (c, o, t, v) => { metal(c, o, t, { base: 720, dur: 0.7, gain: 0.1 * v }); return noiseHit(c, o, t, { type: 'highpass', freq: 6200, dur: 0.8, gain: 0.14 * v }); },
    (c, o, t, v) => tone(c, o, t, { f0: 220, f1: 130, dur: 0.34, wave: 'sine', gain: 0.6 * v }),
  ],
  blocks: [
    (c, o, t, v) => tone(c, o, t, { f0: 420, f1: 400, dur: 0.09, wave: 'triangle', gain: 0.6 * v }),
    (c, o, t, v) => tone(c, o, t, { f0: 900, f1: 870, dur: 0.07, wave: 'triangle', gain: 0.5 * v }),
    (c, o, t, v) => tone(c, o, t, { f0: 2400, f1: 2300, dur: 0.05, wave: 'square', gain: 0.22 * v }),
    (c, o, t, v) => noiseHit(c, o, t, { type: 'bandpass', freq: 6500, q: 1.6, dur: 0.06, gain: 0.3 * v }),
    (c, o, t, v) => tone(c, o, t, { f0: 1500, f1: 1480, dur: 0.028, wave: 'square', gain: 0.2 * v }),
    (c, o, t, v) => metal(c, o, t, { base: 560, dur: 0.28, gain: 0.24 * v }),
  ],
  world: [
    (c, o, t, v) => tone(c, o, t, { f0: 210, f1: 160, dur: 0.22, wave: 'sine', gain: 0.7 * v }),
    (c, o, t, v) => tone(c, o, t, { f0: 330, f1: 280, dur: 0.16, wave: 'sine', gain: 0.6 * v }),
    (c, o, t, v) => tone(c, o, t, { f0: 520, f1: 440, dur: 0.12, wave: 'triangle', gain: 0.5 * v }),
    (c, o, t, v) => tone(c, o, t, { f0: 2400, f1: 2300, dur: 0.05, wave: 'square', gain: 0.22 * v }),
    (c, o, t, v) => noiseHit(c, o, t, { type: 'bandpass', freq: 5800, q: 1.4, dur: 0.07, gain: 0.28 * v }),
    (c, o, t, v) => metal(c, o, t, { base: 620, dur: 0.3, gain: 0.22 * v }),
  ],
};

export function playDrum(ctx, out, kitId, pieceIndex, time, vel = 0.85) {
  const kit = KIT_VOICES[kitId] || KIT_VOICES.electronic;
  const voice = kit[pieceIndex % kit.length];
  return voice(ctx, out, time, Math.max(0.05, vel));
}

/** A short click for the metronome. */
export function playClick(ctx, out, time, strong) {
  return tone(ctx, out, time, {
    f0: strong ? 1600 : 1050, f1: strong ? 1600 : 1050,
    dur: 0.03, wave: 'square', gain: strong ? 0.22 : 0.13,
  });
}
