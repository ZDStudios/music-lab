/* Save slots in localStorage, plus packing a whole song into a URL hash. */

import { packProject, unpackProject } from './project.js';

const SLOT_KEY = 'mls.songs.v1';
const AUTOSAVE_KEY = 'mls.autosave.v1';
const PREF_KEY = 'mls.prefs.v1';

/* ---------------- local save slots ---------------- */

export function listSongs() {
  try {
    const raw = JSON.parse(localStorage.getItem(SLOT_KEY) || '{}');
    return Object.keys(raw).sort().map((name) => ({ name, at: raw[name].at || 0 }));
  } catch {
    return [];
  }
}

export function saveSong(name, project) {
  const all = readAll();
  all[name] = { at: Date.now(), data: packProject(project) };
  write(SLOT_KEY, all);
}

/** Storage can be unavailable (private mode, sandboxed frame) or full. */
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadSong(name) {
  const all = readAll();
  return all[name] ? unpackProject(all[name].data) : null;
}

export function deleteSong(name) {
  const all = readAll();
  delete all[name];
  write(SLOT_KEY, all);
}

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(SLOT_KEY) || '{}');
  } catch {
    return {};
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
