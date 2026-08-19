/* The song library in localStorage, plus packing a whole song into a URL hash. */

import { packProject, unpackProject, totalSteps } from './project.js';
import { getScale } from './scales.js';

const LIB_KEY = 'mls.library.v2';
const OLD_SLOT_KEY = 'mls.songs.v1';      // name-keyed slots from the first version
const AUTOSAVE_KEY = 'mls.autosave.v1';
const PREF_KEY = 'mls.prefs.v1';

/* ------------------------------------------------------------------ *
 * The library
 *
 * Entries live in localStorage — this browser, this device, no account.
 * Shape: { id, name, at, data: <packed project>, meta: <card summary> }
 * ------------------------------------------------------------------ */

/** Storage can be unavailable (private mode, sandboxed frame) or full. */
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function newId() {
  return 's' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
}

function readLibrary() {
  let lib;
  try {
    lib = JSON.parse(localStorage.getItem(LIB_KEY) || 'null');
  } catch {
    lib = null;
  }
  if (lib && typeof lib === 'object') return lib;
  return migrateOldSlots();
}

/** Carry songs over from the original name-keyed save slots, once. */
function migrateOldSlots() {
  let old;
  try {
    old = JSON.parse(localStorage.getItem(OLD_SLOT_KEY) || 'null');
  } catch {
    old = null;
  }
  const lib = {};
  if (old && typeof old === 'object') {
    for (const [name, entry] of Object.entries(old)) {
      if (!entry || !entry.data) continue;
      const id = newId();
      lib[id] = { id, name, at: entry.at || Date.now(), data: entry.data, meta: summarize(entry.data) };
    }
    // Only drop the old copy once the new one is safely written.
    if (write(LIB_KEY, lib)) {
      try { localStorage.removeItem(OLD_SLOT_KEY); } catch { /* keep it */ }
    }
  }
  return lib;
}

/** The few facts a library card shows, so browsing never unpacks a song. */
function summarize(packed) {
  const patterns = (packed.patterns || []).filter(
    (pat) => pat && Object.values(pat.notes || {}).some((n) => n && n.length));
  let notes = 0;
  for (const pat of patterns) {
    for (const list of Object.values(pat.notes || {})) notes += list.length;
  }
  return {
    tempo: packed.tempo,
    root: packed.root,
    scale: getScale(packed.scale).name,
    bars: packed.bars,
    steps: totalSteps(packed),
    tracks: (packed.tracks || []).length,
    patterns: patterns.length,
    notes,
  };
}

export function listLibrary() {
  const lib = readLibrary();
  return Object.values(lib)
    .filter((e) => e && e.id && e.data)
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

export function getLibraryEntry(id) {
  return readLibrary()[id] || null;
}

/** Open a saved song. Returns a project, or null if the entry has gone. */
export function openFromLibrary(id) {
  const entry = getLibraryEntry(id);
  if (!entry) return null;
  const project = unpackProject(entry.data);
  project.libraryId = id;
  project.name = entry.name;
  return project;
}

/**
 * Save the project. Pass an id to update that entry, otherwise a new one is
 * created. Returns the id, or null when storage refused the write.
 */
export function saveToLibrary(project, id = null) {
  const lib = readLibrary();
  const key = (id && lib[id]) ? id : newId();
  const data = packProject(project);
  const name = (project.name || '').trim() || 'Untitled song';
  lib[key] = { id: key, name, at: Date.now(), data, meta: summarize(data) };
  return write(LIB_KEY, lib) ? key : null;
}

export function renameInLibrary(id, name) {
  const lib = readLibrary();
  if (!lib[id]) return false;
  lib[id].name = (name || '').trim().slice(0, 60) || 'Untitled song';
  if (lib[id].data) lib[id].data.name = lib[id].name;
  return write(LIB_KEY, lib);
}

export function deleteFromLibrary(id) {
  const lib = readLibrary();
  if (!lib[id]) return false;
  delete lib[id];
  return write(LIB_KEY, lib);
}

export function duplicateInLibrary(id) {
  const lib = readLibrary();
  const entry = lib[id];
  if (!entry) return null;
  const key = newId();
  lib[key] = { ...entry, id: key, at: Date.now(), name: nextCopyName(lib, entry.name) };
  return write(LIB_KEY, lib) ? key : null;
}

function nextCopyName(lib, name) {
  const base = name.replace(/ \(copy( \d+)?\)$/, '');
  const taken = new Set(Object.values(lib).map((e) => e.name));
  if (!taken.has(`${base} (copy)`)) return `${base} (copy)`;
  for (let i = 2; i < 99; i++) {
    if (!taken.has(`${base} (copy ${i})`)) return `${base} (copy ${i})`;
  }
  return `${base} (copy)`;
}

export function libraryUsage() {
  let bytes = 0;
  try {
    bytes = (localStorage.getItem(LIB_KEY) || '').length;
  } catch { /* unavailable */ }
  return { count: listLibrary().length, bytes };
}

export function storageAvailable() {
  try {
    const probe = '__mls_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- autosave ---------------- */

export function autosave(project) {
  write(AUTOSAVE_KEY, packProject(project));
}

export function readAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? unpackProject(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/* ---------------- preferences (theme etc.) ---------------- */

export function savePrefs(prefs) {
  write(PREF_KEY, prefs);
}

export function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; }
}

/* ---------------- share links ---------------- */

function toB64Url(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function squeeze(bytes, mode) {
  const Stream = mode === 'deflate' ? self.CompressionStream : self.DecompressionStream;
  if (!Stream) return null;
  try {
    const stream = new Stream('deflate-raw');
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const buf = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** Returns a hash fragment like `#z<base64>` (compressed) or `#p<base64>`. */
export async function encodeShare(project) {
  const json = JSON.stringify(packProject(project));
  const bytes = new TextEncoder().encode(json);
  const deflated = await squeeze(bytes, 'deflate');
  return deflated && deflated.length < bytes.length ? 'z' + toB64Url(deflated) : 'p' + toB64Url(bytes);
}

export async function decodeShare(hash) {
  const body = hash.replace(/^#/, '');
  if (!body) return null;
  const kind = body[0];
  const payload = body.slice(1);
  let bytes = fromB64Url(payload);
  if (kind === 'z') {
    const inflated = await squeeze(bytes, 'inflate');
    if (!inflated) throw new Error('This browser cannot read compressed links.');
    bytes = inflated;
  } else if (kind !== 'p') {
    return null;
  }
  return unpackProject(JSON.parse(new TextDecoder().decode(bytes)));
}

export const HOSTED_URL = 'https://zdstudios.github.io/music-lab/';

/** True when the page's own URL is not something a friend could open. */
function embedded() {
  if (location.protocol === 'file:' || location.protocol === 'blob:') return true;
  try {
    return window.top !== window.self;
  } catch {
    return true;   // cross-origin frame
  }
}

export async function shareUrl(project) {
  const hash = await encodeShare(project);
  const root = embedded() ? HOSTED_URL : location.href.split('#')[0];
  return root + '#' + hash;
}

/* ---------------- file download / upload ---------------- */

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeFileName(name, fallback = 'song') {
  const s = (name || '').trim().replace(/[^\w\d\-. ]+/g, '').replace(/\s+/g, '-').slice(0, 48);
  return s || fallback;
}
