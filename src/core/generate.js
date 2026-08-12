/* The "Ideas" button: musical starting points that always land in key and in time. */

import { totalSteps, stepsPerBar } from './project.js';
import { CHORD_SHAPES } from './scales.js';

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const chance = (p) => Math.random() < p;

/** Euclidean rhythm: spread `pulses` as evenly as possible over `steps`. */
export function euclid(steps, pulses, rotate = 0) {
  const out = new Array(steps).fill(false);
  if (pulses <= 0 || steps <= 0) return out;
  const k = Math.min(pulses, steps);
  for (let i = 0; i < k; i++) out[(Math.floor((i * steps) / k) + rotate) % steps] = true;
  return out;
}

/** Common chord progressions, written as scale degrees (0 = tonic). */
const PROGRESSIONS = [
  [0, 5, 3, 4],
  [0, 3, 4, 4],
  [0, 4, 5, 3],
  [5, 3, 0, 4],
  [0, 0, 3, 4],
  [0, 6, 3, 4],
];

export function generate(project, track, style, pitchCount) {
  const steps = totalSteps(project);
  const spb = project.splits;                 // steps per beat
  const bar = stepsPerBar(project);
  const bars = project.bars;
  const ctx = { project, track, steps, spb, bar, bars, pitchCount };

  let chosen = style;
  if (style === 'auto') {
    if (track.type === 'drums') chosen = chance(0.5) ? 'fourfloor' : 'euclid';
    else if (/bass/i.test(track.instrument) || /bass/i.test(track.name)) chosen = 'bassline';
    else if (/pad|string|organ/i.test(track.instrument)) chosen = 'chords';
    else chosen = chance(0.35) ? 'arp' : 'melody';
  }
  if (track.type === 'drums' && !['euclid', 'fourfloor'].includes(chosen)) {
    chosen = chance(0.5) ? 'fourfloor' : 'euclid';
  }
  if (track.type !== 'drums' && ['euclid', 'fourfloor'].includes(chosen)) {
    chosen = 'melody';
  }

  switch (chosen) {
    case 'euclid':    return drumsEuclid(ctx);
    case 'fourfloor': return drumsFourFloor(ctx);
    case 'arp':       return melodyArp(ctx);
    case 'chords':    return melodyChords(ctx);
    case 'bassline':  return melodyBass(ctx);
    case 'sparkle':   return melodySparkle(ctx);
    default:          return melodyTune(ctx);
  }
}

/* ------------------------------- drums ------------------------------- */

function drumsFourFloor({ steps, spb, bar }) {
  const notes = [];
  const add = (s, p, v = 0.85) => { if (s < steps) notes.push({ s, p, l: 1, v }); };

  for (let s = 0; s < steps; s += spb) add(s, 0, 0.95);                       // kick on every beat
  for (let s = 2 * spb; s < steps; s += 4 * spb) add(s, 1, 0.9);              // snare on 3
  for (let s = spb; s < steps; s += 2 * spb) add(s, 3, 0.5);                  // hat off-beats
  if (chance(0.7)) for (let s = spb / 2 | 0; s < steps; s += spb) if (s % spb) add(s, 3, 0.35);
  for (let s = 0; s < steps; s += bar * 2) add(s + bar * 2 - spb, 4, 0.6);    // open hat lift
  if (chance(0.6)) add(steps - 1, 5, 0.7);
  return notes;
}

function drumsEuclid({ steps, spb }) {
  const notes = [];
  const layers = [
    { row: 0, pulses: pick([3, 4, 5, 5, 7]), rot: 0, v: 0.95 },
    { row: 1, pulses: pick([2, 3, 4]), rot: pick([2, 4, spb]), v: 0.85 },
    { row: 3, pulses: pick([7, 8, 9, 11, 13]), rot: 0, v: 0.45 },
  ];
  if (chance(0.5)) layers.push({ row: 2, pulses: pick([3, 5]), rot: pick([1, 3]), v: 0.6 });
  if (chance(0.4)) layers.push({ row: 5, pulses: pick([2, 3]), rot: pick([5, 7]), v: 0.55 });

  for (const l of layers) {
    const hits = euclid(steps, Math.round((l.pulses * steps) / 16) || 1, l.rot);
    hits.forEach((on, s) => { if (on) notes.push({ s, p: l.row, l: 1, v: l.v * (0.85 + Math.random() * 0.3) }); });
  }
  return notes;
}

/* ------------------------------ melodic ------------------------------ */

function progression(bars) {
  const base = pick(PROGRESSIONS);
  return Array.from({ length: bars }, (_, i) => base[i % base.length]);
}

/**
 * The pitch ladder is scale degrees stacked octave after octave, so a degree
 * number maps straight to a row — degree 9 in a 7-note scale is the third of
 * the next octave, which is exactly what we want from a chord shape.
 */
function degreeToRow(deg, pitchCount, octaveBias = 0) {
  const perOct = Math.max(1, guessDegreesPerOctave(pitchCount));
  return Math.max(0, Math.min(pitchCount - 1, Math.round(deg) + octaveBias * perOct));
}

function guessDegreesPerOctave(pitchCount) {
  // pitchCount = degrees*octaves + 1 (the ladder is capped with the octave root).
  for (const d of [5, 6, 7, 12]) {
    if ((pitchCount - 1) % d === 0) return d;
  }
  return 7;
}

function melodyChords({ steps, bar, bars, pitchCount }) {
  const notes = [];
  const prog = progression(bars);
  const shape = pick([CHORD_SHAPES.triad, CHORD_SHAPES.triad, CHORD_SHAPES.seventh, CHORD_SHAPES.wide]);
  for (let b = 0; b < bars; b++) {
    const root = prog[b];
    const len = Math.max(1, Math.round(chance(0.35) ? bar / 2 : bar));
    for (let s = b * bar; s < (b + 1) * bar && s < steps; s += len) {
      for (const iv of shape) {
        notes.push({ s, p: degreeToRow(root + iv, pitchCount), l: Math.min(len, steps - s), v: 0.6 });
      }
    }
  }
  return notes;
}

function melodyArp({ steps, spb, bar, bars, pitchCount }) {
  const notes = [];
  const prog = progression(bars);
  const shape = pick([[0, 2, 4, 2], [0, 2, 4, 7], [0, 4, 2, 4], [0, 2, 4, 6]]);
  const step = Math.max(1, Math.round(spb / 2));
  let i = 0;
  for (let s = 0; s < steps; s += step) {
    const b = Math.floor(s / bar) % bars;
    notes.push({
      s,
      p: degreeToRow(prog[b] + shape[i % shape.length], pitchCount),
      l: step,
      v: i % shape.length === 0 ? 0.9 : 0.62,
    });
    i++;
  }
  return notes;
}

function melodyBass({ steps, spb, bar, bars, pitchCount }) {
  const notes = [];
  const prog = progression(bars);
  const feel = pick(['held', 'pump', 'walk']);
  for (let b = 0; b < bars; b++) {
    const root = degreeToRow(prog[b], pitchCount);
    const start = b * bar;
    if (feel === 'held') {
      notes.push({ s: start, p: root, l: Math.min(bar, steps - start), v: 0.9 });
    } else if (feel === 'pump') {
      for (let s = start; s < start + bar && s < steps; s += spb) {
        notes.push({ s, p: root, l: Math.max(1, spb - 1), v: s === start ? 0.95 : 0.7 });
      }
    } else {
      const walk = [0, 0, 4, 2];
      for (let k = 0; k < 4; k++) {
        const s = start + Math.round((k * bar) / 4);
        if (s >= steps) break;
        notes.push({
          s,
          p: degreeToRow(prog[b] + walk[k], pitchCount),
          l: Math.max(1, Math.round(bar / 4)),
          v: k === 0 ? 0.95 : 0.72,
        });
      }
    }
  }
  return notes;
}

function melodyTune({ steps, spb, bar, bars, pitchCount }) {
  const notes = [];
  const prog = progression(bars);
  const perOct = guessDegreesPerOctave(pitchCount);
  const rhythms = [
    [2, 2, 4], [4, 2, 2], [2, 1, 1, 4], [4, 4], [1, 1, 2, 4], [2, 2, 2, 2],
  ];
  let deg = prog[0] + pick([0, 2, 4]);
  for (let b = 0; b < bars; b++) {
    const chordRoot = prog[b];
    const rhythm = pick(rhythms);
    let s = b * bar;
    for (const r of rhythm) {
      const len = Math.max(1, Math.round((r * bar) / 8));
      if (s >= (b + 1) * bar || s >= steps) break;
      const strong = s % bar === 0;
      if (strong) {
        deg = chordRoot + pick([0, 2, 4]);
      } else {
        deg += pick([-2, -1, -1, 1, 1, 2, chance(0.15) ? 3 : 1]);
      }
      deg = Math.max(0, Math.min(perOct * 2 - 1, deg));
      const row = degreeToRow(deg, pitchCount);
      if (!chance(0.12) || strong) {
        notes.push({ s, p: row, l: Math.min(len, steps - s), v: strong ? 0.95 : 0.72 });
      }
      s += len;
    }
  }
  // Land on the tonic.
  const last = notes[notes.length - 1];
  if (last) last.p = degreeToRow(0, pitchCount, Math.floor(last.p / perOct));
  return notes;
}

function melodySparkle({ steps, spb, pitchCount }) {
  const notes = [];
  const perOct = guessDegreesPerOctave(pitchCount);
  const high = Math.max(0, pitchCount - perOct - 1);
  const step = Math.max(1, Math.round(spb / 2));
  for (let s = 0; s < steps; s += step) {
    if (!chance(0.3)) continue;
    const row = Math.min(pitchCount - 1, high + rnd(perOct + 1));
    notes.push({ s, p: row, l: step, v: 0.35 + Math.random() * 0.35 });
  }
  return notes;
}

/* ---------------------------- note editing ---------------------------- */

export function transposeNotes(notes, delta, maxRow) {
  for (const n of notes) n.p = Math.max(0, Math.min(maxRow, n.p + delta));
}

export function nudgeNotes(notes, delta, maxStep) {
  for (const n of notes) n.s = Math.max(0, Math.min(maxStep - 1, n.s + delta));
}
