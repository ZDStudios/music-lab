/* The project model: instruments, kits, defaults and the helpers that read a song. */

export const PROJECT_VERSION = 1;
export const PATTERN_COUNT = 8;
export const PATTERN_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/* ------------------------------------------------------------------ *
 * Instruments
 * ------------------------------------------------------------------ */

export const MELODY_INSTRUMENTS = [
  { id: 'marimba',  name: 'Marimba',    gm: 12 },
  { id: 'piano',    name: 'Piano',      gm: 0 },
  { id: 'musicbox', name: 'Music box',  gm: 10 },
  { id: 'pluck',    name: 'Plucked',    gm: 45 },
  { id: 'strings',  name: 'Strings',    gm: 48 },
  { id: 'brass',    name: 'Brass',      gm: 61 },
  { id: 'flute',    name: 'Flute',      gm: 73 },
  { id: 'organ',    name: 'Organ',      gm: 16 },
  { id: 'lead',     name: 'Synth lead', gm: 80 },
  { id: 'pad',      name: 'Warm pad',   gm: 89 },
  { id: 'bass',     name: 'Bass',       gm: 38 },
];

export const DRUM_KITS = [
  {
    id: 'electronic', name: 'Electronic',
    pieces: [
      { id: 'kick',  name: 'Kick',     gm: 36, color: '#ff6b6b' },
      { id: 'snare', name: 'Snare',    gm: 38, color: '#ffa94d' },
      { id: 'clap',  name: 'Clap',     gm: 39, color: '#ffd43b' },
      { id: 'hat',   name: 'Hat',      gm: 42, color: '#8ce99a' },
      { id: 'open',  name: 'Open hat', gm: 46, color: '#66d9e8' },
      { id: 'tom',   name: 'Tom',      gm: 45, color: '#b197fc' },
    ],
  },
  {
    id: 'acoustic', name: 'Acoustic kit',
    pieces: [
      { id: 'kick',  name: 'Kick',     gm: 36, color: '#ff6b6b' },
      { id: 'snare', name: 'Snare',    gm: 38, color: '#ffa94d' },
      { id: 'rim',   name: 'Rim',      gm: 37, color: '#ffd43b' },
      { id: 'hat',   name: 'Hat',      gm: 42, color: '#8ce99a' },
      { id: 'ride',  name: 'Ride',     gm: 51, color: '#66d9e8' },
      { id: 'tom',   name: 'Tom',      gm: 47, color: '#b197fc' },
    ],
  },
  {
    id: 'blocks', name: 'Wood blocks',
    pieces: [
      { id: 'low',    name: 'Low',    gm: 77, color: '#ff8787' },
      { id: 'high',   name: 'High',   gm: 76, color: '#ffb066' },
      { id: 'clave',  name: 'Clave',  gm: 75, color: '#ffe066' },
      { id: 'shaker', name: 'Shaker', gm: 82, color: '#a9e34b' },
      { id: 'tick',   name: 'Tick',   gm: 80, color: '#63e6be' },
      { id: 'bell',   name: 'Cowbell',gm: 56, color: '#a5b4fc' },
    ],
  },
  {
    id: 'world', name: 'Congas',
    pieces: [
      { id: 'congaLo', name: 'Conga low',  gm: 64, color: '#ff8787' },
      { id: 'congaHi', name: 'Conga high', gm: 63, color: '#ffb066' },
      { id: 'bongo',   name: 'Bongo',      gm: 60, color: '#ffe066' },
      { id: 'clave',   name: 'Clave',      gm: 75, color: '#a9e34b' },
      { id: 'shaker',  name: 'Shaker',     gm: 82, color: '#63e6be' },
      { id: 'bell',    name: 'Bell',       gm: 56, color: '#a5b4fc' },
    ],
  },
];

export const TRACK_COLORS = ['#4dd6c1', '#ff9f6b', '#7c8cff', '#ffd166', '#f97eb9', '#8ce99a', '#66d9e8', '#c9a4ff'];

export const THEMES = [
  { id: 'aurora', name: 'Aurora' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'forest', name: 'Forest' },
  { id: 'mono', name: 'Mono' },
  { id: 'paper', name: 'Paper (light)' },
  { id: 'candy', name: 'Candy (light)' },
];

export function getKit(id) {
  return DRUM_KITS.find((k) => k.id === id) || DRUM_KITS[0];
}

export function instrumentName(track) {
  if (track.type === 'drums') return getKit(track.instrument).name;
  const i = MELODY_INSTRUMENTS.find((m) => m.id === track.instrument);
  return i ? i.name : track.instrument;
}

/* ------------------------------------------------------------------ *
 * Construction
 * ------------------------------------------------------------------ */

let idSeed = 0;
function nextId(prefix) {
  idSeed += 1;
  return prefix + idSeed.toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

export function createTrack(type, opts = {}) {
  return {
    id: opts.id || nextId('t'),
    type,                                   // 'melody' | 'drums'
    name: opts.name || (type === 'drums' ? 'Drums' : 'Melody'),
    instrument: opts.instrument || (type === 'drums' ? 'electronic' : 'marimba'),
    volume: opts.volume ?? 0.8,
    pan: opts.pan ?? 0,
    mute: false,
    solo: false,
    collapsed: false,
    color: opts.color || TRACK_COLORS[0],
    octaveShift: opts.octaveShift ?? 0,     // melody tracks only
  };
}

function emptyPatterns() {
  return Array.from({ length: PATTERN_COUNT }, (_, i) => ({
    name: PATTERN_LETTERS[i],
    notes: {},
  }));
}

export function createProject() {
  const melody = createTrack('melody', { name: 'Marimba', instrument: 'marimba', color: TRACK_COLORS[0] });
  const bass = createTrack('melody', { name: 'Bass', instrument: 'bass', color: TRACK_COLORS[2], octaveShift: -1, volume: 0.75 });
  const drums = createTrack('drums', { name: 'Drums', instrument: 'electronic', color: TRACK_COLORS[1] });
  return {
    version: PROJECT_VERSION,
    name: '',
    tempo: 112,
    swing: 0,
    humanize: 0,
    scale: 'major',
    root: 'C',
    octave: 4,
    octaves: 2,
    bars: 4,
    beatsPerBar: 4,
    splits: 2,
    tracks: [melody, bass, drums],
    patterns: emptyPatterns(),
    patternIndex: 0,
    arrangement: [],
    songMode: false,
    selected: melody.id,
    fx: {
      reverb: 0.22, reverbSize: 0.6, delay: 0, delayTime: 0.5,
      tone: 1, drive: 0.08, chorus: 0.15, master: 0.85,
    },
    showLabels: true,
    useFlats: false,
    accidentals: false,
    theme: 'aurora',
  };
}

/** A small starter groove so the first press of Play makes music. */
export function createDemoProject() {
  const p = createProject();
  p.name = 'Sunrise demo';
  p.tempo = 108;
  p.swing = 0.12;
  p.fx.delay = 0.18;
  const [lead, bass, drums] = p.tracks;

  const n = (s, pitch, l = 1, v = 0.85) => ({ s, p: pitch, l, v });

  // Pattern A — main groove. Pitch rows are scale degrees of C major, 0 = C4.
  const a = p.patterns[0];
  a.notes[lead.id] = [
    n(0, 7, 2), n(4, 4, 2), n(8, 5, 2), n(12, 4, 1), n(14, 2, 2),
    n(18, 7, 2), n(22, 9, 2), n(26, 7, 4, 0.7),
  ];
  a.notes[bass.id] = [
    n(0, 0, 3), n(6, 0, 2), n(10, 4, 3), n(16, 5, 3), n(22, 5, 2), n(26, 3, 4),
  ];
  a.notes[drums.id] = [
    n(0, 0), n(6, 0), n(10, 0), n(16, 0), n(22, 0), n(26, 0),
    n(4, 1), n(12, 1), n(20, 1), n(28, 1),
    n(2, 3, 1, 0.5), n(6, 3, 1, 0.5), n(10, 3, 1, 0.5), n(14, 3, 1, 0.5),
    n(18, 3, 1, 0.5), n(22, 3, 1, 0.5), n(26, 3, 1, 0.5), n(30, 3, 1, 0.5),
    n(8, 4, 1, 0.45), n(24, 4, 1, 0.45),
  ];

  // Pattern B — a lift.
  const b = p.patterns[1];
  b.notes[lead.id] = [
    n(0, 9, 2), n(4, 11, 2), n(8, 12, 4), n(14, 9, 2), n(18, 7, 2), n(22, 9, 6, 0.75),
  ];
  b.notes[bass.id] = [n(0, 2, 4), n(8, 5, 4), n(16, 4, 4), n(24, 0, 6)];
  b.notes[drums.id] = a.notes[drums.id].map((x) => ({ ...x })).concat([n(30, 2, 1, 0.8), n(31, 1, 1, 0.6)]);

  p.arrangement = [0, 0, 1, 0];
  return p;
}

/* ------------------------------------------------------------------ *
 * Reading a song
 * ------------------------------------------------------------------ */

export const stepsPerBar = (p) => p.beatsPerBar * p.splits;
export const totalSteps = (p) => p.bars * p.beatsPerBar * p.splits;

export function activePattern(p) {
  return p.patterns[p.patternIndex] || p.patterns[0];
}

export function notesOf(pattern, trackId) {
  if (!pattern.notes[trackId]) pattern.notes[trackId] = [];
  return pattern.notes[trackId];
}

export function findTrack(p, id) {
  return p.tracks.find((t) => t.id === id) || p.tracks[0];
}

export function rowCount(p, track, pitchCount) {
  return track.type === 'drums' ? getKit(track.instrument).pieces.length : pitchCount;
}

/** The note whose span covers `step` on `row`, if any. */
export function noteAt(notes, step, row) {
  for (let i = notes.length - 1; i >= 0; i--) {
    const nt = notes[i];
    if (nt.p === row && nt.s <= step && step < nt.s + Math.max(1, nt.l)) return nt;
  }
  return null;
}

/**
 * Stretch or squash every note in time. Used when the beat subdivision changes
 * so the music keeps its rhythm instead of shifting to a different beat.
 */
export function rescaleNotes(p, factor) {
  if (!Number.isFinite(factor) || factor === 1) return;
  for (const pattern of p.patterns) {
    for (const notes of Object.values(pattern.notes || {})) {
      for (const n of notes) {
        n.s = Math.max(0, Math.round(n.s * factor));
        n.l = Math.max(1, Math.round(Math.max(1, n.l) * factor));
      }
    }
  }
}

/**
 * Move melody notes to the rows that hold the same pitches in a new ladder.
 * Adding or removing the accidental rows shifts every row index, so without
 * this the song would be scrambled by a settings toggle.
 */
export function remapNotesToLadder(p, oldPitches, newPitches) {
  if (!oldPitches.length || !newPitches.length) return;
  const byMidi = new Map();
  newPitches.forEach((pitch, i) => {
    if (!byMidi.has(pitch.midi)) byMidi.set(pitch.midi, i);
  });
  const nearest = (midi) => {
    let best = 0;
    let bestD = Infinity;
    newPitches.forEach((pitch, i) => {
      const d = Math.abs(pitch.midi - midi);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };

  const melodyIds = new Set(p.tracks.filter((t) => t.type !== 'drums').map((t) => t.id));
  for (const pattern of p.patterns) {
    for (const [trackId, notes] of Object.entries(pattern.notes || {})) {
      if (!melodyIds.has(trackId)) continue;
      for (const note of notes) {
        const old = oldPitches[note.p];
        if (!old) continue;
        note.p = byMidi.has(old.midi) ? byMidi.get(old.midi) : nearest(old.midi);
      }
    }
  }
}

export function audibleTracks(p) {
  const soloed = p.tracks.some((t) => t.solo);
  return p.tracks.filter((t) => (soloed ? t.solo : !t.mute));
}

/* ------------------------------------------------------------------ *
 * Serialisation
 * ------------------------------------------------------------------ */

export function cloneProject(p) {
  return JSON.parse(JSON.stringify(p));
}

/** Drop empty patterns/notes so shared links and files stay small. */
export function packProject(p) {
  const out = cloneProject(p);
  out.patterns = out.patterns.map((pat) => {
    const notes = {};
    for (const [k, v] of Object.entries(pat.notes || {})) {
      if (v && v.length) {
        notes[k] = v.map((nt) => (nt.l === 1 && nt.v === 0.85 ? [nt.s, nt.p] : [nt.s, nt.p, nt.l, Math.round(nt.v * 100)]));
      }
    }
    return { name: pat.name, notes };
  });
  return out;
}

export function unpackProject(raw) {
  const base = createProject();
  const p = { ...base, ...raw };
  p.fx = { ...base.fx, ...(raw.fx || {}) };
  p.tracks = (raw.tracks && raw.tracks.length ? raw.tracks : base.tracks).map((t) => ({
    ...createTrack(t.type === 'drums' ? 'drums' : 'melody', { id: t.id }),
    ...t,
  }));
  const pats = emptyPatterns();
  (raw.patterns || []).forEach((pat, i) => {
    if (i >= PATTERN_COUNT || !pat) return;
    pats[i].name = pat.name || PATTERN_LETTERS[i];
    for (const [k, v] of Object.entries(pat.notes || {})) {
      pats[i].notes[k] = (v || []).map((nt) =>
        Array.isArray(nt)
          ? { s: nt[0], p: nt[1], l: nt[2] ?? 1, v: nt[3] == null ? 0.85 : nt[3] / 100 }
          : { s: nt.s, p: nt.p, l: nt.l ?? 1, v: nt.v ?? 0.85 });
    }
  });
  p.patterns = pats;
  p.patternIndex = Math.min(PATTERN_COUNT - 1, Math.max(0, p.patternIndex | 0));
  p.arrangement = (raw.arrangement || []).filter((i) => Number.isInteger(i) && i >= 0 && i < PATTERN_COUNT);
  if (!p.tracks.some((t) => t.id === p.selected)) p.selected = p.tracks[0].id;
  p.bars = clampInt(p.bars, 1, 16);
  p.beatsPerBar = clampInt(p.beatsPerBar, 1, 12);
  p.splits = clampInt(p.splits, 1, 6);
  p.octaves = clampInt(p.octaves, 1, 4);
  p.octave = clampInt(p.octave, 1, 7);
  p.tempo = clampInt(p.tempo, 40, 240);
  return p;
}

function clampInt(v, lo, hi) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}
