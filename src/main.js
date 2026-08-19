/* Music Lab Studio — app wiring. */

import {
  createProject, createDemoProject, activePattern, notesOf, noteAt, totalSteps,
  stepsPerBar, findTrack, getKit, createTrack, instrumentName,
  MELODY_INSTRUMENTS, DRUM_KITS, TRACK_COLORS,
  PATTERN_LETTERS, PATTERN_COUNT, cloneProject, packProject, unpackProject,
} from './core/project.js';
import { buildPitchList, snapToLadder, freqToMidi } from './core/scales.js';
import { createStore } from './core/state.js';
import { generate } from './core/generate.js';
import * as store$ from './core/storage.js';
import { exportMidi, MidiIn } from './core/midi.js';
import { Rig, Transport, stepSeconds } from './audio/engine.js';
import { renderProject, encodeWav } from './audio/render.js';
import { MicPitch } from './audio/mic.js';
import { GridView } from './ui/grid.js';
import { Rail } from './ui/rail.js';
import { Panels } from './ui/panels.js';
import { Library } from './ui/library.js';
import { openPopover, closePopover } from './ui/popover.js';
import { instrumentIcon } from './ui/icons.js';
import { toast } from './ui/toast.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

const store = createStore(createProject());
let pitchList = [];
let audio = null;              // { ctx, rig, transport, mic }
let midiIn = null;
let raf = 0;
let autosaveTimer = 0;
let shareTimer = 0;
let lastChainIndex = -2;
const heldKeys = new Map();    // key → { row, trackId }
let micState = null;

const grid = new GridView({
  stage: $('stage'),
  canvas: $('grid'),
  scroller: $('grid-scroll'),
  spacer: $('grid-spacer'),
  store,
  getPitchList: () => pitchList,
  hooks: {
    onFirstTouch: () => { ensureAudio(); hideHint(); },
    onPreview: (track, row, vel) => preview(track, row, vel),
    onSelectTrack: () => { rail.updateSelection(); syncSoundPickers(); },
    onTracksChanged: () => refreshLayout(),
    onEdit: () => { markDirty(); updatePatternPills(); },
    onEditCommitted: () => markDirty(),
    onScrub: (step) => scrubTo(step),
  },
});

const rail = new Rail({
  list: $('rail-list'),
  addButton: $('btn-add-track'),
  store,
  hooks: {
    onChange: (kind) => {
      if (kind === 'layout') refreshLayout();
      else if (kind === 'select') { rail.updateSelection(); syncSoundPickers(); grid.invalidate(); }
      else if (kind === 'name') { syncSoundPickers(); grid.invalidate(); }
      else if (kind === 'vol') audio?.rig.syncTracks(store.project);
      else { rail.render(); audio?.rig.syncTracks(store.project); grid.invalidate(); }
      markDirty();
    },
    onMessage: (m) => toast(m),
  },
});

const panels = new Panels({
  store,
  hooks: {
    onLayout: () => refreshLayout(),
    onFeel: () => markDirty(),
    onFx: () => { syncFx(); markDirty(); },
    onMix: (relayout) => {
      audio?.rig.syncTracks(store.project);
      if (relayout) grid.invalidate();
      markDirty();
    },
    onTheme: () => { applyTheme(); markDirty(); },
    onOpen: (name) => {
      if (name !== 'export') return;
      refreshShareLink();
      library.render();
      updateSaveButton();
    },
  },
});

/* ------------------------------------------------------------------ *
 * Audio
 * ------------------------------------------------------------------ */

function ensureAudio() {
  if (audio) {
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    toast('This browser has no Web Audio support.', { error: true });
    return null;
  }
  const ctx = new Ctx({ latencyHint: 'interactive' });
  const rig = new Rig(ctx, store.project);
  rig.updateTempo(store.project.tempo, store.project.fx.delayTime);
  const transport = new Transport({
    ctx,
    rig,
    getProject: () => store.project,
    getPitchList: () => pitchList,
  });
  audio = { ctx, rig, transport, mic: new MicPitch(ctx) };
  return audio;
}

function syncFx() {
  if (!audio) return;
  audio.rig.updateFx(store.project.fx);
  audio.rig.updateTempo(store.project.tempo, store.project.fx.delayTime);
}

function preview(track, row, vel = 0.85) {
  const a = ensureAudio();
  if (!a) return;
  const p = store.project;
  a.rig.trigger(track, { s: 0, p: row, l: 1, v: vel }, a.ctx.currentTime + 0.015, pitchList, stepSeconds(p));
}

/* ------------------------------------------------------------------ *
 * Refresh plumbing
 * ------------------------------------------------------------------ */

function refreshPitches() {
  pitchList = buildPitchList(store.project);
}

/** Rows / bars / instruments changed — rebuild everything that depends on them. */
function refreshLayout() {
  refreshPitches();
  rail.render();
  grid.clearSelection();
  grid.refresh();
  syncSoundPickers();
  updatePatternPills();
  updateChain();
  if (!audio?.transport.playing) refreshPlayhead();
  audio?.rig.syncTracks(store.project);
  syncFx();
  if (panels.open === 'settings') panels.syncSettings();
  if (panels.open === 'mixer') panels.syncMixer();
  markDirty();
}

/** A whole new project object (load, undo, redo). */
function adoptProject() {
  applyTheme();
  refreshPitches();
  rail.render();
  grid.refresh();
  syncTransportUI();
  syncSoundPickers();
  updatePatternPills();
  updateChain();
  audio?.rig.syncTracks(store.project);
  syncFx();
  if (panels.open === 'settings') panels.syncSettings();
  if (panels.open === 'mixer') panels.syncMixer();
  $('song-name').value = store.project.name || '';
  $('tempo').value = String(store.project.tempo);
  $('tempo-val').textContent = String(store.project.tempo);
  $('master-vol').value = String(store.project.fx.master);
  if (!audio?.transport.playing) refreshPlayhead();
  document.title = (store.project.name ? store.project.name + ' — ' : '') + 'Music Lab Studio';
}

store.subscribe((kind) => {
  if (kind === 'project') adoptProject();
});

function markDirty() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => store$.autosave(store.project), 700);
  clearTimeout(shareTimer);
  if (panels.open === 'export') shareTimer = setTimeout(refreshShareLink, 400);
  updateUndoButtons();
}

function updateUndoButtons() {
  $('btn-undo').disabled = !store.canUndo();
  $('btn-redo').disabled = !store.canRedo();
}

function applyTheme() {
  document.documentElement.dataset.theme = store.project.theme || 'aurora';
  store$.savePrefs({ theme: store.project.theme });
  requestAnimationFrame(() => grid.refreshTheme());
}

function hideHint() {
  const hint = $('stage-hint');
  if (hint && !hint.classList.contains('gone')) hint.classList.add('gone');
}

/* ------------------------------------------------------------------ *
 * Transport UI
 * ------------------------------------------------------------------ */

function play() {
  const a = ensureAudio();
  if (!a) return;
  if (a.ctx.state === 'suspended') a.ctx.resume();
  a.rig.syncTracks(store.project);
  syncFx();
  a.transport.start();
  $('app').classList.add('playing');
  $('btn-play').setAttribute('aria-label', 'Pause');
  if (store.ui.recording) startMicIfNeeded();
  loop();
}

function pause() {
  if (!audio) return;
  audio.transport.stop();
  $('app').classList.remove('playing');
  cancelAnimationFrame(raf);
  raf = 0;
  lastChainIndex = -2;
  // The playhead stays put, so you can see — and drag — where play resumes.
  refreshPlayhead();
  updateChain();
}

function stop() {
  pause();
  audio?.transport.rewind();
  refreshPlayhead();
}

/** Where the playhead sits right now, whether or not anything is playing. */
function currentPosition() {
  if (audio) return audio.transport.current();
  return { local: 0, patternIndex: store.project.patternIndex, chainIndex: -1, frac: 0, paused: true };
}

function refreshPlayhead() {
  const pos = currentPosition();
  grid.setPlay(pos);
  updatePosReadout(pos);
}

/** Dragging the bar ruler moves the playhead; playback follows it. */
function scrubTo(step) {
  const a = ensureAudio();
  if (!a) return;
  a.transport.seekLocal(step);
  refreshPlayhead();
  hideHint();
}

let lastPlayPress = 0;

function togglePlay() {
  const now = performance.now();
  const doublePress = now - lastPlayPress < 420;
  lastPlayPress = now;

  // Two quick presses send the playhead back to the top and play from there.
  if (doublePress) {
    const a = ensureAudio();
    if (!a) return;
    a.transport.seek(0);
    if (!a.transport.playing) play();
    else refreshPlayhead();
    return;
  }
  if (audio?.transport.playing) pause();
  else play();
}

function loop() {
  cancelAnimationFrame(raf);
  const tick = () => {
    if (!audio?.transport.playing) return;
    const pos = audio.transport.position();
    if (pos) {
      // In song mode the view follows the arrangement.
      if (store.project.songMode && pos.patternIndex !== store.project.patternIndex) {
        store.project.patternIndex = pos.patternIndex;
        updatePatternPills();
      }
      if (pos.chainIndex !== lastChainIndex) {
        lastChainIndex = pos.chainIndex;
        updateChain();
      }
      grid.setPlay(pos);
      updatePosReadout(pos);
      if (store.ui.recording) pollMic();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function updatePosReadout(pos) {
  const p = store.project;
  const bar = stepsPerBar(p);
  if (!pos) {
    $('pos').innerHTML = '1<i>.</i>1';
    return;
  }
  $('pos').classList.toggle('paused', !!pos.paused);
  const b = Math.floor(pos.local / bar) + 1;
  const beat = Math.floor((pos.local % bar) / p.splits) + 1;
  $('pos').innerHTML = `${b}<i>.</i>${beat}`;
}

function syncTransportUI() {
  const p = store.project;
  $('btn-mode').textContent = p.songMode ? 'Song' : 'Loop';
  $('btn-metro').setAttribute('aria-pressed', String(!!audio?.transport.metronome));
  $('btn-rec').setAttribute('aria-pressed', String(store.ui.recording));
  document.querySelectorAll('#tool-seg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.tool === store.ui.tool);
  });
  $('grid-scroll').className = 'grid-scroll tool-' + store.ui.tool;
  updateUndoButtons();
}

/* ------------------------------------------------------------------ *
 * Patterns and arrangement
 * ------------------------------------------------------------------ */

function patternHasNotes(i) {
  const pat = store.project.patterns[i];
  return !!pat && Object.values(pat.notes || {}).some((arr) => arr && arr.length);
}

function updatePatternPills() {
  const p = store.project;
  const host = $('pattern-pills');
  if (host.children.length !== PATTERN_COUNT) {
    host.innerHTML = PATTERN_LETTERS.map((l, i) => `<button class="pill" data-pattern="${i}" title="Pattern ${l}">${l}</button>`).join('');
  }
  [...host.children].forEach((btn, i) => {
    btn.classList.toggle('on', i === p.patternIndex);
    btn.classList.toggle('has', patternHasNotes(i));
  });
}

function selectPattern(i) {
  const p = store.project;
  p.patternIndex = Math.max(0, Math.min(PATTERN_COUNT - 1, i));
  grid.clearSelection();
  grid.invalidate();
  updatePatternPills();
  updateChain();
  if (!audio?.transport.playing) refreshPlayhead();
  markDirty();
}

function updateChain() {
  const p = store.project;
  const playing = audio?.transport.playing ? audio.transport.position() : null;
  $('chain').innerHTML = p.arrangement.map((idx, i) => {
    const on = playing && playing.chainIndex === i;
    return `<button class="chip${on ? ' on' : ''}" data-chain="${i}" title="Remove ${PATTERN_LETTERS[idx]} from the song">${PATTERN_LETTERS[idx]}</button>`;
  }).join('');
}

/* ------------------------------------------------------------------ *
 * Recording and live play
 * ------------------------------------------------------------------ */

function rowFromMidi(track, midi) {
  if (track.type === 'drums') {
    const pieces = getKit(track.instrument).pieces;
    const exact = pieces.findIndex((pc) => pc.gm === midi);
    return exact >= 0 ? exact : ((midi % pieces.length) + pieces.length) % pieces.length;
  }
  return snapToLadder(pitchList, midi - 12 * (track.octaveShift || 0));
}

function writeRecordedNote(row, vel) {
  const a = audio;
  if (!a) return null;
  const p = store.project;
  const rec = a.transport.recordStep();
  if (!rec) return null;
  const track = findTrack(p, p.selected);
  const pattern = p.patterns[rec.patternIndex];
  const notes = notesOf(pattern, track.id);
  const existing = noteAt(notes, rec.step, row);
  if (existing) return { note: existing, step: rec.step };
  store.snapshot('record');
  const note = { s: rec.step, p: row, l: 1, v: Math.max(0.3, Math.min(1, vel)) };
  notes.push(note);
  store.endGesture();
  grid.invalidate();
  updatePatternPills();
  markDirty();
  return { note, step: rec.step };
}

function noteOn(midi, vel) {
  const p = store.project;
  const track = findTrack(p, p.selected);
  const row = rowFromMidi(track, midi);
  preview(track, row, vel || 0.85);
  if (store.ui.recording && audio?.transport.playing) writeRecordedNote(row, vel || 0.85);
  return row;
}

async function startMicIfNeeded() {
  const a = ensureAudio();
  if (!a || a.mic.active) return;
  const track = findTrack(store.project, store.project.selected);
  if (track.type === 'drums') return;   // humming a drum kit is not a thing
  try {
    const ok = await a.mic.start();
    if (ok) toast('Listening — hum or sing a tune');
  } catch {
    toast('Microphone blocked. MIDI and the letter keys still record.', { error: true });
  }
}

let lastMicRead = 0;

function pollMic() {
  const a = audio;
  if (!a?.mic.active) return;
  const now = performance.now();
  if (now - lastMicRead < 70) return;
  lastMicRead = now;

  const read = a.mic.read();
  if (!read || read.clarity < 0.9) {
    micState = null;
    return;
  }
  const p = store.project;
  const track = findTrack(p, p.selected);
  if (track.type === 'drums') return;
  const row = snapToLadder(pitchList, Math.round(freqToMidi(read.freq)));
  const rec = a.transport.recordStep();
  if (!rec) return;

  if (micState && micState.row === row && micState.patternIndex === rec.patternIndex) {
    if (rec.step === micState.lastStep) return;
    if (rec.step === micState.lastStep + 1) {
      micState.note.l = Math.max(1, rec.step - micState.note.s + 1);
      micState.lastStep = rec.step;
      grid.invalidate();
      return;
    }
  }
  const written = writeRecordedNote(row, 0.85);
  if (written) {
    micState = { row, note: written.note, lastStep: written.step, patternIndex: rec.patternIndex };
    preview(track, row, 0.8);
  }
}

function toggleRecording() {
  store.ui.recording = !store.ui.recording;
  $('btn-rec').setAttribute('aria-pressed', String(store.ui.recording));
  if (store.ui.recording) {
    ensureAudio();
    initMidi();
    if (audio?.transport.playing) startMicIfNeeded();
    toast('Record armed — press play, then sing, tap keys or play MIDI');
  } else {
    audio?.mic.stop();
    micState = null;
  }
}

async function initMidi() {
  if (midiIn) return;
  midiIn = new MidiIn();
  const ok = await midiIn.init();
  if (!ok) {
    midiIn = null;
    return;
  }
  midiIn.onNote((midi, vel, on) => {
    if (!on) return;
    ensureAudio();
    noteOn(midi, vel);
  });
  if (midiIn.deviceNames.length) toast('MIDI in: ' + midiIn.deviceNames.join(', '));
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

const PLAY_KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'];

function isTyping(e) {
  const el = e.target;
  return el instanceof HTMLElement
    && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

window.addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;

  if (mod) {
    switch (key) {
      case 'z':
        e.preventDefault();
        if (e.shiftKey ? store.redo() : store.undo()) toast(e.shiftKey ? 'Redo' : 'Undo', { ms: 900 });
        return;
      case 'y': e.preventDefault(); store.redo(); return;
      case 'c': if (grid.copySelection()) toast('Copied', { ms: 900 }); return;
      case 'x':
        if (grid.copySelection()) { grid.deleteSelection(); markDirty(); toast('Cut', { ms: 900 }); }
        return;
      case 'v': if (grid.pasteClipboard()) { markDirty(); toast('Pasted', { ms: 900 }); } return;
      case 'a': e.preventDefault(); grid.selectAll(); return;
      case 's': e.preventDefault(); doSaveLocal(); return;
      case 'd': e.preventDefault(); grid.clearSelection(); return;
      default: return;
    }
  }

  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlay();
      return;
    case 'Enter':
      e.preventDefault();
      stop();
      return;
    case 'Escape':
      closePopover();
      panels.close();
      grid.clearSelection();
      return;
    case 'Delete':
    case 'Backspace':
      if (grid.deleteSelection()) { markDirty(); updatePatternPills(); }
      return;
    case 'ArrowUp': e.preventDefault(); if (grid.moveSelection(-1, 0)) markDirty(); return;
    case 'ArrowDown': e.preventDefault(); if (grid.moveSelection(1, 0)) markDirty(); return;
    case 'ArrowLeft': e.preventDefault(); if (grid.moveSelection(0, -1)) markDirty(); return;
    case 'ArrowRight': e.preventDefault(); if (grid.moveSelection(0, 1)) markDirty(); return;
    case '?': panels.toggle('help'); return;
    case '[': selectPattern(store.project.patternIndex - 1); return;
    case ']': selectPattern(store.project.patternIndex + 1); return;
    case '+': case '=': grid.setZoom(grid.zoom * 1.15); return;
    case '-': grid.setZoom(grid.zoom / 1.15); return;
    default: break;
  }

  if (key === '1' || key === '2' || key === '3') {
    setTool(['draw', 'erase', 'select'][Number(key) - 1]);
    return;
  }
  if (key === 'r') { toggleRecording(); return; }
  if (key === 't') { rail.addTrack(); return; }
  if (key === 'e') { panels.toggle('export'); return; }
  if (key === 'o') { panels.toggle('settings'); return; }
  if (key === 'i') { panels.toggle('mixer'); return; }
  if (key === 'p') { toggleMetronome(); return; }

  // Live play on the home row (hold shift for the register above).
  const idx = PLAY_KEYS.indexOf(key);
  if (idx >= 0 && !heldKeys.has(key)) {
    const p = store.project;
    const track = findTrack(p, p.selected);
    const offset = e.shiftKey ? 7 : 0;
    const maxRow = track.type === 'drums' ? getKit(track.instrument).pieces.length - 1 : pitchList.length - 1;
    const row = Math.min(maxRow, idx + offset);
    heldKeys.set(key, row);
    ensureAudio();
    preview(track, row, 0.9);
    if (store.ui.recording && audio?.transport.playing) writeRecordedNote(row, 0.9);
  }
});

window.addEventListener('keyup', (e) => {
  heldKeys.delete(e.key.toLowerCase());
});

function setTool(tool) {
  store.ui.tool = tool;
  syncTransportUI();
}

function toggleMetronome() {
  const a = ensureAudio();
  if (!a) return;
  a.transport.metronome = !a.transport.metronome;
  $('btn-metro').setAttribute('aria-pressed', String(a.transport.metronome));
}

/* ------------------------------------------------------------------ *
 * Controls
 * ------------------------------------------------------------------ */

$('btn-play').addEventListener('click', togglePlay);
$('btn-stop').addEventListener('click', stop);
$('btn-rec').addEventListener('click', toggleRecording);
$('btn-metro').addEventListener('click', toggleMetronome);
$('btn-mode').addEventListener('click', () => {
  const p = store.project;
  if (!p.songMode && !p.arrangement.length) {
    toast('Add patterns to the Song strip first');
    return;
  }
  p.songMode = !p.songMode;
  syncTransportUI();
  updateChain();
  markDirty();
});

$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());

$('tempo').addEventListener('input', (e) => {
  store.snapshot('tempo');
  store.project.tempo = Number(e.target.value);
  $('tempo-val').textContent = e.target.value;
  syncFx();
  markDirty();
});
$('tempo').addEventListener('change', () => store.endGesture());

$('master-vol').addEventListener('input', (e) => {
  store.snapshot('master');
  store.project.fx.master = Number(e.target.value);
  syncFx();
  if (panels.open === 'mixer') panels.syncMixer();
  markDirty();
});
$('master-vol').addEventListener('change', () => store.endGesture());

$('tool-seg').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tool]');
  if (btn) setTool(btn.dataset.tool);
});

$('pattern-pills').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pattern]');
  if (btn) selectPattern(Number(btn.dataset.pattern));
});

$('chain').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-chain]');
  if (!btn) return;
  const i = Number(btn.dataset.chain);
  store.snapshot('chain');
  store.project.arrangement.splice(i, 1);
  if (!store.project.arrangement.length) store.project.songMode = false;
  store.endGesture();
  updateChain();
  syncTransportUI();
  markDirty();
});

$('btn-chain-add').addEventListener('click', () => {
  const p = store.project;
  if (p.arrangement.length >= 32) {
    toast('That is a long song — 32 sections is the limit');
    return;
  }
  store.snapshot('chain');
  p.arrangement.push(p.patternIndex);
  store.endGesture();
  updateChain();
  markDirty();
  toast(`Pattern ${PATTERN_LETTERS[p.patternIndex]} added to the song`, { ms: 1200 });
});

$('btn-pattern-menu').addEventListener('click', (e) => openPatternMenu(e.currentTarget));

$('btn-gen').addEventListener('click', () => {
  const p = store.project;
  const track = findTrack(p, p.selected);
  const style = $('gen-style').value;
  store.snapshot('generate');
  const pattern = activePattern(p);
  pattern.notes[track.id] = generate(p, track, style, pitchList);
  store.endGesture();
  grid.invalidate();
  updatePatternPills();
  markDirty();
  hideHint();
  ensureAudio();
  toast(`New part for ${track.name}`, { ms: 1300 });
});

$('btn-clear-track').addEventListener('click', () => {
  const p = store.project;
  const track = findTrack(p, p.selected);
  store.snapshot('clear-track');
  activePattern(p).notes[track.id] = [];
  store.endGesture();
  grid.invalidate();
  updatePatternPills();
  markDirty();
});

/* --------------------------- sound pickers --------------------------- */

/**
 * The two big pickers at the bottom, in the spirit of Song Maker: one for the
 * melody instrument, one for the drum kit. They act on the selected track when
 * it is of that type, otherwise on the first track that is.
 */
function targetTrack(type) {
  const p = store.project;
  const selected = findTrack(p, p.selected);
  if (selected && selected.type === type) return selected;
  return p.tracks.find((t) => t.type === type) || null;
}

function syncSoundPickers() {
  for (const [type, id] of [['melody', 'pick-melody'], ['drums', 'pick-drums']]) {
    const btn = $(id);
    const track = targetTrack(type);
    const label = type === 'melody' ? 'melody instrument' : 'drum kit';
    btn.classList.toggle('empty', !track);
    btn.querySelector('.si').innerHTML = instrumentIcon(track ? track.instrument : (type === 'melody' ? 'marimba' : 'electronic'));
    btn.querySelector('.sn').textContent = track ? instrumentName(track) : (type === 'melody' ? 'Add melody' : 'Add drums');
    btn.title = track
      ? `Change the ${label} for “${track.name}”`
      : `Add a ${type === 'melody' ? 'melody' : 'drum'} track`;
  }
}

function previewInstrument(track) {
  const a = ensureAudio();
  if (!a) return;
  const t = a.ctx.currentTime + 0.02;
  const dur = stepSeconds(store.project);
  if (track.type === 'drums') {
    const beats = [[0, 0], [3, 0.16], [1, 0.32]];   // kick · hat · snare
    for (const [row, delay] of beats) {
      a.rig.trigger(track, { s: 0, p: row, l: 1, v: 0.9 }, t + delay, pitchList, dur);
    }
  } else {
    const notes = [0, 2, 4].map((d) => Math.min(pitchList.length - 1, d));
    notes.forEach((row, i) => {
      a.rig.trigger(track, { s: 0, p: row, l: 2, v: 0.85 }, t + i * 0.13, pitchList, dur);
    });
  }
}

function openSoundPicker(anchor, type) {
  const p = store.project;
  const track = targetTrack(type);
  const options = type === 'drums' ? DRUM_KITS : MELODY_INSTRUMENTS;
  const heading = type === 'drums' ? 'Drum kit' : 'Melody instrument';

  const html = `
    <div class="pop-head"><span>${heading}</span><b>${track ? esc(track.name) : 'new track'}</b></div>
    <div class="sound-grid">
      ${options.map((o) => `
        <button class="sound-opt${track && o.id === track.instrument ? ' on' : ''}" data-value="${o.id}">
          ${instrumentIcon(o.id)}<span>${esc(o.name)}</span>
        </button>`).join('')}
    </div>`;

  openPopover({
    anchor,
    html,
    className: 'sound-menu',
    onPick: (id) => {
      store.snapshot('instrument');
      let target = track;
      if (!target) {
        const option = options.find((o) => o.id === id);
        target = createTrack(type, {
          instrument: id,
          name: type === 'drums' ? 'Drums' : (option ? option.name : 'Melody'),
          color: TRACK_COLORS[p.tracks.length % TRACK_COLORS.length],
        });
        p.tracks.push(target);
        p.selected = target.id;
      } else {
        target.instrument = id;
        // Keep a default name in step with the sound, but never rename a
        // track the user has named themselves.
        const auto = (type === 'drums' ? DRUM_KITS : MELODY_INSTRUMENTS)
          .some((o) => o.name === target.name) || target.name === 'Drums' || target.name === 'Melody';
        if (auto && type === 'melody') {
          target.name = options.find((o) => o.id === id)?.name || target.name;
        }
      }
      store.endGesture();
      // A different kit means a different set of rows.
      refreshLayout();
      previewInstrument(target);
      hideHint();
    },
  });
}

$('pick-melody').addEventListener('click', (e) => openSoundPicker(e.currentTarget, 'melody'));
$('pick-drums').addEventListener('click', (e) => openSoundPicker(e.currentTarget, 'drums'));

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------------------- pattern menu ---------------------------- */

function openPatternMenu(anchor) {
  const p = store.project;
  const items = [
    ['Duplicate to next free pattern', () => {
      const target = store.project.patterns.findIndex((_, i) => i !== p.patternIndex && !patternHasNotes(i));
      if (target < 0) return toast('No empty pattern left', { error: true });
      store.snapshot('dup-pattern');
      p.patterns[target].notes = cloneProject(activePattern(p)).notes;
      store.endGesture();
      selectPattern(target);
      toast(`Copied to pattern ${PATTERN_LETTERS[target]}`);
    }],
    ['Clear this pattern', () => {
      store.snapshot('clear-pattern');
      activePattern(p).notes = {};
      store.endGesture();
      grid.invalidate();
      updatePatternPills();
      markDirty();
    }],
    ['Double the notes (fill the bars)', () => {
      store.snapshot('double');
      const steps = totalSteps(p);
      const pattern = activePattern(p);
      let span = 0;
      for (const notes of Object.values(pattern.notes)) {
        for (const n of notes) span = Math.max(span, n.s + Math.max(1, n.l));
      }
      if (!span) return toast('Nothing to repeat yet');
      for (const notes of Object.values(pattern.notes)) {
        const copy = notes.map((n) => ({ ...n }));
        for (let off = span; off < steps; off += span) {
          for (const n of copy) {
            if (n.s + off < steps) notes.push({ ...n, s: n.s + off });
          }
        }
      }
      store.endGesture();
      grid.invalidate();
      markDirty();
    }],
  ];
  openPopover({
    anchor,
    html: items.map(([label], i) => `<button data-value="${i}">${label}</button>`).join(''),
    onPick: (i) => items[Number(i)][1](),
  });
}

/* ------------------------------------------------------------------ *
 * Share / save / export
 * ------------------------------------------------------------------ */

async function refreshShareLink() {
  try {
    const url = await store$.shareUrl(store.project);
    $('share-url').value = url;
    if (url.length > 7500) toast('This song makes a very long link — saving a .json file is safer', { ms: 3000 });
  } catch {
    $('share-url').value = '';
  }
}

$('song-name').addEventListener('input', (e) => {
  store.project.name = e.target.value.slice(0, 60);
  document.title = (store.project.name ? store.project.name + ' — ' : '') + 'Music Lab Studio';
  markDirty();
});
$('song-name').addEventListener('change', () => {
  const id = store.project.libraryId;
  if (id && store$.getLibraryEntry(id)) {
    store$.renameInLibrary(id, store.project.name);
    library.render();
  }
});

$('btn-copy-link').addEventListener('click', async () => {
  await refreshShareLink();
  const url = $('share-url').value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    $('share-url').select();
    document.execCommand('copy');
    toast('Link copied');
  }
  history.replaceState(null, '', '#' + url.split('#')[1]);
});

/* ---------------------------- song library ---------------------------- */

const library = new Library({
  root: $('library'),
  store,
  hooks: {
    onOpen: (project) => {
      stop();
      store.replace(project);
      toast(`Opened “${project.name}”`);
    },
    onRenamed: (id, name) => {
      if (store.project.libraryId === id) {
        store.project.name = name;
        $('song-name').value = name;
        document.title = (name ? name + ' — ' : '') + 'Music Lab Studio';
      }
    },
    onExport: (entry) => {
      const blob = new Blob([JSON.stringify(entry.data, null, 1)], { type: 'application/json' });
      saveBlob(blob, store$.safeFileName(entry.name) + '.json');
    },
    onCopyLink: async (entry) => {
      try {
        const url = await store$.shareUrl(store$.openFromLibrary(entry.id) || store.project);
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      } catch {
        toast('Could not copy the link — open the song and use Copy above.', { error: true });
      }
    },
    onMessage: (message, error = false) => toast(message, { error }),
  },
});

/** Save keeps you on the same library entry; it never quietly makes copies. */
function doSaveLocal() {
  const name = (store.project.name || '').trim() || 'Untitled song';
  store.project.name = name;
  $('song-name').value = name;

  const existing = store.project.libraryId && store$.getLibraryEntry(store.project.libraryId);
  const id = store$.saveToLibrary(store.project, existing ? store.project.libraryId : null);
  if (!id) {
    toast('This browser would not store the song — check that site data is allowed.', { error: true, ms: 4000 });
    return;
  }
  store.project.libraryId = id;
  library.render();
  updateSaveButton();
  toast(existing ? `Saved “${name}”` : `“${name}” added to your library`);
}

function updateSaveButton() {
  const linked = store.project.libraryId && store$.getLibraryEntry(store.project.libraryId);
  $('btn-save-local').textContent = linked ? 'Save changes' : 'Save this song';
}

$('btn-save-local').addEventListener('click', doSaveLocal);

$('export-loops').addEventListener('input', (e) => { $('out-loops').textContent = e.target.value; });

function setProgress(v) {
  const bar = $('export-progress');
  bar.hidden = v == null;
  if (v != null) bar.firstElementChild.style.width = Math.round(v * 100) + '%';
}

async function saveBlob(blob, filename) {
  // The desktop build offers a real Save-As dialog.
  if (window.desktop?.saveFile) {
    const buf = await blob.arrayBuffer();
    const res = await window.desktop.saveFile(filename, buf);
    if (res?.ok) toast('Saved to ' + res.path);
    else if (res && !res.canceled) toast('Could not save the file', { error: true });
    return;
  }

  // Sandboxed hosts block ordinary download links, but some offer the viewer a
  // save prompt instead. Their allowlists are narrow — projects get through,
  // audio and MIDI usually do not — so say so rather than failing silently.
  const host = window.claude?.downloads;
  if (host) {
    try {
      await host.save({ filename, data: blob });
      toast('Saved');
    } catch (err) {
      const code = err && err.code;
      if (code === 'declined') return;
      if (code === 'rejected_extension' || code === 'extension_not_enabled') {
        toast('This preview can only save project files — open the full app to export audio and MIDI.', { error: true, ms: 4200 });
      } else if (code === 'too_large') {
        toast('Too big to save here — try fewer repeats.', { error: true });
      } else {
        toast('Could not save the file', { error: true });
      }
    }
    return;
  }

  store$.download(blob, filename);
}

$('btn-export-wav').addEventListener('click', async () => {
  const btn = $('btn-export-wav');
  btn.disabled = true;
  setProgress(0.02);
  try {
    const loops = Number($('export-loops').value) || 2;
    const buffer = await renderProject(store.project, pitchList, { loops, onProgress: setProgress });
    const blob = encodeWav(buffer);
    await saveBlob(blob, store$.safeFileName(store.project.name) + '.wav');
    toast('Audio exported');
  } catch (err) {
    console.error(err);
    toast('Export failed: ' + (err?.message || err), { error: true });
  } finally {
    btn.disabled = false;
    setTimeout(() => setProgress(null), 600);
  }
});

$('btn-export-midi').addEventListener('click', () => {
  try {
    const loops = Number($('export-loops').value) || 1;
    const blob = exportMidi(store.project, pitchList, { loops });
    saveBlob(blob, store$.safeFileName(store.project.name) + '.mid');
    toast('MIDI exported');
  } catch (err) {
    console.error(err);
    toast('MIDI export failed', { error: true });
  }
});

$('btn-export-json').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(packProject(store.project), null, 1)], { type: 'application/json' });
  saveBlob(blob, store$.safeFileName(store.project.name) + '.json');
});

$('btn-import-json').addEventListener('click', () => $('file-input').click());

$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const loaded = unpackProject(JSON.parse(text));
    loaded.libraryId = null;
    stop();
    store.replace(loaded);
    library.render();
    updateSaveButton();
    toast(`Imported “${loaded.name || 'song'}” — press Save to keep it in your library`, { ms: 3600 });
  } catch {
    toast('That file could not be read as a project', { error: true });
  }
  e.target.value = '';
});

$('btn-new').addEventListener('click', () => {
  stop();
  const fresh = createProject();
  fresh.theme = store.project.theme;
  store.replace(fresh);
  library.render();
  updateSaveButton();
  toast('Fresh song');
});

$('btn-demo').addEventListener('click', () => {
  stop();
  const demo = createDemoProject();
  demo.theme = store.project.theme;
  store.replace(demo);
  library.render();
  updateSaveButton();
  toast('Demo loaded — press play');
  hideHint();
});

/* ------------------------------------------------------------------ *
 * Start up
 * ------------------------------------------------------------------ */

async function boot() {
  let project = null;
  let source = '';

  if (location.hash.length > 3) {
    try {
      project = await store$.decodeShare(location.hash);
      project.libraryId = null;      // a shared song is not yet on this shelf
      source = 'link';
    } catch {
      toast('That shared link could not be read', { error: true });
    }
  }
  if (!project) {
    project = store$.readAutosave();
    if (project) source = 'autosave';
  }
  if (!project) {
    project = createDemoProject();
    source = 'demo';
  }
  const prefs = store$.readPrefs();
  if (prefs.theme && source !== 'link') project.theme = prefs.theme;

  store.state.project = project;
  adoptProject();
  library.render();
  updateSaveButton();
  updateUndoButtons();
  if (!store$.storageAvailable()) {
    toast('This browser is not letting the app store songs, so the library and autosave are off.',
      { error: true, ms: 5000 });
  }

  $('about-line').textContent =
    `Music Lab Studio ${window.desktop?.version ? 'desktop ' + window.desktop.version : '1.0'} · everything runs on your device — no accounts, no uploads.`;

  if (source === 'link') toast('Shared song loaded — press play');
  if (source === 'demo') hintLater();
}

function hintLater() {
  setTimeout(hideHint, 9000);
}

window.addEventListener('beforeunload', () => store$.autosave(store.project));

document.addEventListener('visibilitychange', () => {
  if (document.hidden && audio?.transport.playing) pause();
});

boot();
