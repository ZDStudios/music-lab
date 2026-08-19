/*
 * The song library: every song you have saved in this browser, with a little
 * picture of its notes so you can spot the one you want at a glance.
 */

import * as store$ from '../core/storage.js';
import { openPopover } from './popover.js';
import { TRACK_COLORS } from '../core/project.js';

const THUMB_W = 104;
const THUMB_H = 38;
const FILTER_FROM = 6;      // show the search box once the shelf gets busy

export class Library {
  constructor({ root, store, hooks }) {
    this.root = root;
    this.store = store;
    this.hooks = hooks;
    this.filter = '';

    root.addEventListener('click', (e) => this._onClick(e));
    root.addEventListener('input', (e) => this._onInput(e));
    // `change` on a text field lands when it loses focus with a new value —
    // it catches typing that never went through a click on the field.
    root.addEventListener('change', (e) => {
      const card = e.target.closest('[data-id]');
      if (!card || !e.target.matches('.song-title')) return;
      store$.renameInLibrary(card.dataset.id, e.target.value);
      this.hooks.onRenamed?.(card.dataset.id, e.target.value);
      this.render();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('.song-title')) e.target.blur();
    });
  }

  /* ------------------------------ rendering ------------------------------ */

  render() {
    const entries = store$.listLibrary();
    const openId = this.store.project.libraryId;
    const needle = this.filter.trim().toLowerCase();
    const shown = needle ? entries.filter((e) => e.name.toLowerCase().includes(needle)) : entries;

    if (!entries.length) {
      this.root.innerHTML = `
        <p class="empty-lib">Nothing saved yet. <b>Save this song</b> puts it on the shelf —
        it stays in this browser, so no account and nothing uploaded.</p>`;
      this._updateUsage();
      return;
    }

    const search = entries.length >= FILTER_FROM
      ? `<input class="lib-filter" type="search" placeholder="Search ${entries.length} songs" value="${esc(this.filter)}">`
      : '';

    const cards = shown.map((entry) => this._card(entry, entry.id === openId)).join('')
      || `<p class="empty-lib">No song matches “${esc(this.filter)}”.</p>`;

    this.root.innerHTML = search + `<div class="song-list">${cards}</div>`;
    for (const canvas of this.root.querySelectorAll('canvas[data-thumb]')) {
      const entry = entries.find((x) => x.id === canvas.dataset.thumb);
      if (entry) drawThumb(canvas, entry);
    }
    this._updateUsage();
  }

  _card(entry, isOpen) {
    const m = entry.meta || {};
    // Split across two lines so nothing important gets cut off.
    const shape = [
      m.tracks ? `${m.tracks} track${m.tracks === 1 ? '' : 's'}` : null,
      m.bars ? `${m.bars} bar${m.bars === 1 ? '' : 's'}` : null,
      m.patterns > 1 ? `${m.patterns} patterns` : null,
    ].filter(Boolean).join(' · ');
    const sound = [
      m.root && m.scale ? `${m.root} ${m.scale.toLowerCase()}` : null,
      m.tempo ? `${m.tempo} bpm` : null,
      `saved ${when(entry.at)}`,
    ].filter(Boolean).join(' · ');

    return `
      <div class="song-card${isOpen ? ' current' : ''}" data-id="${entry.id}">
        <canvas class="song-thumb" data-thumb="${entry.id}"
                width="${THUMB_W}" height="${THUMB_H}" aria-hidden="true"></canvas>
        <div class="song-meta">
          <input class="song-title" data-act="rename" value="${esc(entry.name)}"
                 maxlength="60" aria-label="Song name">
          <span class="song-sub">${isOpen ? '<b>Open now</b> · ' : ''}${esc(shape)}</span>
          <span class="song-sub dim">${esc(sound)}</span>
        </div>
        <div class="song-actions">
          <button class="mini-btn" data-act="open" title="Open this song">Open</button>
          <button class="mini-btn" data-act="menu" title="More">···</button>
        </div>
      </div>`;
  }

  _updateUsage() {
    const el = document.getElementById('lib-usage');
    if (!el) return;
    const { count, bytes } = store$.libraryUsage();
    el.textContent = count
      ? `${count} song${count === 1 ? '' : 's'} · ${(bytes / 1024).toFixed(0)} KB in this browser. `
        + 'Clearing your browsing data would erase them, so export a file or a link for anything you want to keep.'
      : 'Songs are kept in this browser only.';
  }

  /* ----------------------------- interaction ----------------------------- */

  _onInput(e) {
    if (e.target.matches('.lib-filter')) {
      this.filter = e.target.value;
      const box = e.target;
      this.render();
      const again = this.root.querySelector('.lib-filter');
      if (again) {
        again.focus();
        again.setSelectionRange(box.selectionStart, box.selectionEnd);
      }
    }
  }

  _onClick(e) {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const id = card.dataset.id;
    const act = e.target.closest('[data-act]')?.dataset.act;

    if (act === 'rename') return;    // handled by the change listener above
    if (act === 'open') {
      this.open(id);
      return;
    }
    if (act === 'menu') {
      this._menu(e.target.closest('[data-act]'), id);
      return;
    }
    // A click anywhere else on the card opens it too.
    if (!e.target.matches('input')) this.open(id);
  }

  open(id) {
    const project = store$.openFromLibrary(id);
    if (!project) {
      this.hooks.onMessage?.('That song is no longer saved here.', true);
      this.render();
      return;
    }
    this.hooks.onOpen(project);
    this.render();
  }

  _menu(anchor, id) {
    const entry = store$.getLibraryEntry(id);
    if (!entry) return;
    const items = [
      ['Save the current song over this one', () => {
        const saved = store$.saveToLibrary(this.store.project, id);
        if (!saved) return this.hooks.onMessage?.('This browser would not store the song.', true);
        this.store.project.libraryId = id;
        this.hooks.onMessage?.(`Replaced “${entry.name}”`);
        this.render();
      }],
      ['Duplicate', () => {
        const copy = store$.duplicateInLibrary(id);
        if (!copy) return this.hooks.onMessage?.('This browser would not store the song.', true);
        this.render();
      }],
      ['Export as a file', () => this.hooks.onExport?.(entry)],
      ['Copy a link to it', () => this.hooks.onCopyLink?.(entry)],
      ['Delete…', () => this._confirmDelete(anchor, entry)],
    ];
    openPopover({
      anchor,
      html: items.map(([label], i) => `<button data-value="${i}">${label}</button>`).join(''),
      onPick: (i) => items[Number(i)][1](),
    });
  }

  _confirmDelete(anchor, entry) {
    openPopover({
      anchor,
      className: 'confirm-menu',
      html: `<div class="pop-head"><span>Delete “${esc(entry.name)}”?</span></div>
        <button data-value="yes" class="danger-item">Delete permanently</button>
        <button data-value="no">Keep it</button>`,
      onPick: (value) => {
        if (value !== 'yes') return;
        store$.deleteFromLibrary(entry.id);
        if (this.store.project.libraryId === entry.id) this.store.project.libraryId = null;
        this.hooks.onMessage?.(`Deleted “${entry.name}”`);
        this.render();
      },
    });
  }
}

/* -------------------------------- helpers -------------------------------- */

/** A postage-stamp view of the song's busiest pattern. */
function drawThumb(canvas, entry) {
  const g = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = THUMB_W * dpr;
  canvas.height = THUMB_H * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cs = getComputedStyle(document.documentElement);
  g.fillStyle = (cs.getPropertyValue('--grid-cell') || '#171d31').trim();
  g.fillRect(0, 0, THUMB_W, THUMB_H);

  const data = entry.data || {};
  const steps = Math.max(1, (entry.meta && entry.meta.steps) || 32);
  const trackColor = new Map();
  (data.tracks || []).forEach((t, i) => trackColor.set(t.id, t.color || TRACK_COLORS[i % TRACK_COLORS.length]));

  // The pattern with the most notes is the one worth showing.
  let best = null;
  let bestCount = 0;
  for (const pattern of data.patterns || []) {
    const count = Object.values(pattern.notes || {}).reduce((n, list) => n + (list ? list.length : 0), 0);
    if (count > bestCount) { bestCount = count; best = pattern; }
  }
  if (!best) return;

  // Notes are packed as [step, row, length, velocity]; rows are scaled to fit.
  let maxRow = 1;
  for (const list of Object.values(best.notes || {})) {
    for (const n of list) maxRow = Math.max(maxRow, Array.isArray(n) ? n[1] : n.p);
  }

  for (const [trackId, list] of Object.entries(best.notes || {})) {
    g.fillStyle = trackColor.get(trackId) || TRACK_COLORS[0];
    for (const n of list) {
      const s = Array.isArray(n) ? n[0] : n.s;
      const row = Array.isArray(n) ? n[1] : n.p;
      const len = Array.isArray(n) ? (n[2] ?? 1) : (n.l ?? 1);
      const x = (s / steps) * THUMB_W;
      const w = Math.max(1.5, (len / steps) * THUMB_W - 0.5);
      const y = THUMB_H - 3 - (row / maxRow) * (THUMB_H - 6);
      g.fillRect(x, y, w, 2);
    }
  }
}

function when(at) {
  if (!at) return 'a while ago';
  const secs = Math.max(0, (Date.now() - at) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  if (secs < 86400 * 7) return `${Math.floor(secs / 86400)} d ago`;
  return new Date(at).toLocaleDateString();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
