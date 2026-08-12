/* Scales, note naming and the pitch ladder used by the grid. */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES = [
  { id: 'major',      name: 'Major',            steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor',      name: 'Natural minor',    steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonic',   name: 'Harmonic minor',   steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'pentaMaj',   name: 'Pentatonic major', steps: [0, 2, 4, 7, 9] },
  { id: 'pentaMin',   name: 'Pentatonic minor', steps: [0, 3, 5, 7, 10] },
  { id: 'blues',      name: 'Blues',            steps: [0, 3, 5, 6, 7, 10] },
  { id: 'dorian',     name: 'Dorian',           steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian',   name: 'Phrygian',         steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian',     name: 'Lydian',           steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: 'Mixolydian',       steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'hirajoshi',  name: 'Hirajoshi',        steps: [0, 2, 3, 7, 8] },
  { id: 'arabic',     name: 'Arabic',           steps: [0, 1, 4, 5, 7, 8, 11] },
  { id: 'wholeTone',  name: 'Whole tone',       steps: [0, 2, 4, 6, 8, 10] },
  { id: 'chromatic',  name: 'Chromatic',        steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

export function getScale(id) {
  return SCALES.find((s) => s.id === id) || SCALES[0];
}

/** Chord shapes expressed in scale degrees (not semitones) so they always fit the key. */
export const CHORD_SHAPES = {
  triad: [0, 2, 4],
  seventh: [0, 2, 4, 6],
  power: [0, 4],
  wide: [0, 2, 4, 7],
};

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

/**
 * Build the ascending list of pitches a melody track can play.
 * Index 0 is the lowest pitch; the grid draws it at the bottom.
 */
export function buildPitchList({ root = 'C', octave = 4, octaves = 2, scale = 'major' }) {
  const sc = getScale(scale);
  const rootPc = Math.max(0, NOTE_NAMES.indexOf(root));
  const base = (octave + 1) * 12 + rootPc;
  const list = [];
  for (let o = 0; o < octaves; o++) {
    for (let i = 0; i < sc.steps.length; i++) {
      const midi = base + o * 12 + sc.steps[i];
      list.push({ midi, degree: i, octave: o, name: midiName(midi), pc: ((midi % 12) + 12) % 12 });
    }
  }
  // Cap the top of the ladder with the root one octave up — it makes melodies resolve.
  const top = base + octaves * 12;
  list.push({ midi: top, degree: 0, octave: octaves, name: midiName(top), pc: ((top % 12) + 12) % 12 });
  return list;
}

/** Snap any midi note to the nearest pitch available in the ladder. */
export function snapToLadder(list, midi) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = Math.abs(list[i].midi - midi);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/* Hue per pitch class — a rainbow that keeps octaves recognisable. */
const PC_HUE = [352, 12, 32, 46, 58, 128, 158, 182, 205, 232, 268, 310];

export function pitchColor(pc, octaveIndex, octaves) {
  const hue = PC_HUE[pc];
  const spread = Math.max(1, octaves);
  const light = 68 - (octaveIndex / spread) * 16;
  const sat = 78 - (octaveIndex / spread) * 10;
  return `hsl(${hue} ${sat}% ${light}%)`;
}
