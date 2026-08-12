/*
 * The note grid: a virtualised canvas that draws only what is on screen, so a
 * 16-bar song with several tracks still scrolls smoothly on a phone.
 *
 * Layout: the canvas covers the whole stage (including the label gutter and the
 * bar ruler). A transparent scroll container sits on top of the note area and
 * supplies native scrolling plus all pointer input.
 */

import {
  activePattern, notesOf, noteAt, totalSteps, stepsPerBar, getKit, findTrack,
} from '../core/project.js';
import { pitchColor } from '../core/scales.js';

const MIN_CELL = 15;
const MAX_CELL = 58;
const MIN_ROW = 12;
const MAX_ROW = 34;

const VEL_STEPS = [0.45, 0.85, 1.0];

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, f) => (cs.getPropertyValue(n) || f).trim();
  return {
    bg: v('--bg', '#0b0e17'),
    bg2: v('--bg-2', '#121627'),
    panel: v('--panel', '#141a2c'),
    cell: v('--grid-cell', '#171d31'),
    cellAlt: v('--grid-cell-alt', '#1b2238'),
    beat: v('--grid-beat', '#2a3358'),
    bar: v('--grid-bar', '#3b4680'),
    line: v('--line', '#232a45'),
    lineSoft: v('--line-soft', '#1b2138'),
    text: v('--text', '#e8ecf8'),
    dim: v('--text-dim', '#9aa4c4'),
    faint: v('--text-faint', '#626c8c'),
    accent: v('--accent', '#4dd6c1'),
    accent2: v('--accent-2', '#7c8cff'),
    playhead: v('--playhead', '#fff'),
  };
}

export class GridView {
  constructor({ stage, canvas, scroller, spacer, store, getPitchList, hooks = {} }) {
    this.stage = stage;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scroller = scroller;
    this.spacer = spacer;
    this.store = store;
    this.getPitchList = getPitchList;
    this.hooks = hooks;

    this.theme = readTheme();
    this.zoom = 1;
    this.rows = [];
    this.trackLanes = new Map();
    this.play = null;
    this.drag = null;
    this.needsDraw = false;
    this.measureChrome();

    this._onResize = () => this.refresh();
    window.addEventListener('resize', this._onResize);
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => this.refresh());
      this._ro.observe(stage);
    }
    scroller.addEventListener('scroll', () => this.invalidate(), { passive: true });
    scroller.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    scroller.addEventListener('pointerdown', (e) => this._onDown(e));
    scroller.addEventListener('pointermove', (e) => this._onMove(e));
    scroller.addEventListener('pointerup', (e) => this._onUp(e));
    scroller.addEventListener('pointercancel', (e) => this._onUp(e));
    scroller.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* ------------------------------ geometry ------------------------------ */

  refreshTheme() {
    this.theme = readTheme();
    this.invalidate();
  }

  refresh() {
    this.buildRows();
    this.layout();
    this.invalidate();
  }

  buildRows() {
    const p = this.store.project;
    const pitches = this.getPitchList();
    this.rows = [];
    this.trackLanes = new Map();

    for (const track of p.tracks) {
      const base = this.rows.length;
      if (track.collapsed) {
        this.rows.push({ track, type: 'fold', row: 0, label: track.name, color: track.color, first: true, last: true });
        this.trackLanes.set(track.id, { base, count: 1, collapsed: true, track });
        continue;
      }
      if (track.type === 'drums') {
        const pieces = getKit(track.instrument).pieces;
        for (let i = pieces.length - 1; i >= 0; i--) {
          this.rows.push({
            track, type: 'drum', row: i, label: pieces[i].name, color: pieces[i].color,
            first: i === pieces.length - 1, last: i === 0,
          });
        }
        this.trackLanes.set(track.id, { base, count: pieces.length, collapsed: false, track });
      } else {
        for (let i = pitches.length - 1; i >= 0; i--) {
          const pitch = pitches[i];
          this.rows.push({
            track, type: 'melody', row: i,
            label: pitch.name, color: pitchColor(pitch.pc, pitch.octave, p.octaves),
            root: pitch.degree === 0,
            first: i === pitches.length - 1, last: i === 0,
          });
        }
        this.trackLanes.set(track.id, { base, count: pitches.length, collapsed: false, track });
      }
    }
  }

  /** The label gutter and bar ruler shrink on small screens. */
  measureChrome() {
    const narrow = this.stage.clientWidth < 620;
    this.gutter = narrow ? 44 : 62;
    this.ruler = narrow ? 22 : 26;
    this.stage.style.setProperty('--gutter', this.gutter + 'px');
    this.stage.style.setProperty('--ruler', this.ruler + 'px');
  }

  layout() {
    this.measureChrome();
    const p = this.store.project;
    const steps = totalSteps(p);
    const rows = Math.max(1, this.rows.length);
    const viewW = Math.max(80, this.stage.clientWidth - this.gutter);
    const viewH = Math.max(60, this.stage.clientHeight - this.ruler);

    const fitCell = viewW / steps;
    this.cellW = Math.max(MIN_CELL * this.zoom, Math.min(MAX_CELL * this.zoom, fitCell));
    const fitRow = viewH / rows;
    this.rowH = Math.max(MIN_ROW * this.zoom, Math.min(MAX_ROW * this.zoom, fitRow));

    this.contentW = steps * this.cellW;
    this.contentH = rows * this.rowH;
    this.viewW = viewW;
    this.viewH = viewH;
    this.spacer.style.width = Math.round(this.contentW) + 'px';
    this.spacer.style.height = Math.round(this.contentH) + 'px';

    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.dpr = dpr;
    this.w = w;
    this.h = h;
  }

  invalidate() {
    if (this.needsDraw) return;
    this.needsDraw = true;
    requestAnimationFrame(() => {
      this.needsDraw = false;
      this.draw();
    });
  }

  /* -------------------------------- draw -------------------------------- */

  draw() {
    const g = this.ctx;
    const p = this.store.project;
    const t = this.theme;
    if (!this.rowH) this.layout();

    const sx = this.scroller.scrollLeft;
    const sy = this.scroller.scrollTop;
    const steps = totalSteps(p);
    const spb = p.splits;
    const bar = stepsPerBar(p);

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.fillStyle = t.bg;
    g.fillRect(0, 0, this.w, this.h);

    const c0 = Math.max(0, Math.floor(sx / this.cellW));
    const c1 = Math.min(steps, Math.ceil((sx + this.viewW) / this.cellW));
    const r0 = Math.max(0, Math.floor(sy / this.rowH));
    const r1 = Math.min(this.rows.length, Math.ceil((sy + this.viewH) / this.rowH));

    /* ---- note area ---- */
    g.save();
    g.beginPath();
    g.rect(this.gutter, this.ruler, this.w - this.gutter, this.h - this.ruler);
    g.clip();
    g.translate(this.gutter - sx, this.ruler - sy);

    // row backgrounds
    for (let r = r0; r < r1; r++) {
      const row = this.rows[r];
      const y = r * this.rowH;
      const selTrack = row.track.id === p.selected;
      for (let c = c0; c < c1; c++) {
        const beatIndex = Math.floor(c / spb);
        g.fillStyle = beatIndex % 2 === 0 ? t.cell : t.cellAlt;
        g.fillRect(c * this.cellW, y, this.cellW, this.rowH);
      }
      if (row.type === 'fold') {
        g.fillStyle = withAlpha(row.color, 0.06);
        g.fillRect(c0 * this.cellW, y, (c1 - c0) * this.cellW, this.rowH);
      } else if (row.root) {
        g.fillStyle = withAlpha(row.color, 0.07);
        g.fillRect(c0 * this.cellW, y, (c1 - c0) * this.cellW, this.rowH);
      }
      if (!selTrack) {
        g.fillStyle = withAlpha(t.bg, 0.28);
        g.fillRect(c0 * this.cellW, y, (c1 - c0) * this.cellW, this.rowH);
      }
    }

    // grid lines
    g.lineWidth = 1;
    for (let c = c0; c <= c1; c++) {
      const x = Math.round(c * this.cellW) + 0.5;
      const isBar = c % bar === 0;
      const isBeat = c % spb === 0;
      if (!isBeat && this.cellW < 11) continue;
      g.strokeStyle = isBar ? t.bar : isBeat ? t.beat : t.lineSoft;
      g.beginPath();
      g.moveTo(x, r0 * this.rowH);
      g.lineTo(x, r1 * this.rowH);
      g.stroke();
    }
    for (let r = r0; r <= r1; r++) {
      const row = this.rows[r];
      const prev = this.rows[r - 1];
      const boundary = !row || !prev || row.track !== prev.track;
      const y = Math.round(r * this.rowH) + 0.5;
      g.strokeStyle = boundary ? t.bar : t.lineSoft;
      g.beginPath();
      g.moveTo(c0 * this.cellW, y);
      g.lineTo(c1 * this.cellW, y);
      g.stroke();
    }

    /* ---- notes ---- */
    const pattern = activePattern(p);
    const playLocal = this.play && this.play.patternIndex === p.patternIndex ? this.play.local : -1;
    const gap = this.cellW > 22 ? 2 : 1;
    const rgap = this.rowH > 18 ? 2 : 1;

    for (const track of p.tracks) {
      const lane = this.trackLanes.get(track.id);
      const notes = pattern.notes[track.id];
      if (!lane || !notes) continue;
      const dim = track.mute || (p.tracks.some((x) => x.solo) && !track.solo);

      for (const note of notes) {
        const len = Math.max(1, note.l || 1);
        if (note.s + len < c0 || note.s > c1) continue;
        const visual = lane.collapsed ? lane.base : lane.base + (lane.count - 1 - note.p);
        if (visual < r0 - 1 || visual > r1) continue;
        const rowDesc = this.rows[visual];
        if (!rowDesc) continue;

        const x = note.s * this.cellW;
        const y = visual * this.rowH;
        const w = (lane.collapsed ? 1 : len) * this.cellW - gap;
        const h = this.rowH - rgap;
        const vel = note.v ?? 0.85;
        const active = playLocal >= note.s && playLocal < note.s + len;
        const color = lane.collapsed
          ? track.color
          : (rowDesc.type === 'drum' ? rowDesc.color : this.colorForMelodyRow(track, note.p));

        g.globalAlpha = dim ? 0.22 : 0.42 + Math.min(1, vel) * 0.58;
        g.fillStyle = color;
        roundRect(g, x + gap / 2, y + rgap / 2, Math.max(3, w), Math.max(3, h), Math.min(5, this.rowH / 3));
        g.fill();

        if (vel >= 0.95 && !lane.collapsed && this.rowH > 14) {
          g.globalAlpha = dim ? 0.3 : 0.85;
          g.fillStyle = '#fff';
          g.fillRect(x + gap / 2 + 1.5, y + rgap / 2 + 1.5, Math.max(2, w - 3), 1.5);
        }
        if (active) {
          g.globalAlpha = 1;
          g.strokeStyle = t.playhead;
          g.lineWidth = 2;
          roundRect(g, x + gap / 2, y + rgap / 2, Math.max(3, w), Math.max(3, h), Math.min(5, this.rowH / 3));
          g.stroke();
        }
      }
    }
    g.globalAlpha = 1;

    /* ---- selection ---- */
    const sel = this.store.ui.selection;
    if (sel) {
      const x = sel.s0 * this.cellW;
      const y = sel.r0 * this.rowH;
      const w = (sel.s1 - sel.s0 + 1) * this.cellW;
      const h = (sel.r1 - sel.r0 + 1) * this.rowH;
      g.fillStyle = withAlpha(t.accent2, 0.14);
      g.fillRect(x, y, w, h);
      g.strokeStyle = t.accent2;
      g.lineWidth = 1.5;
      g.setLineDash([4, 3]);
      g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      g.setLineDash([]);
    }

    /* ---- playhead ---- */
    if (this.play) {
      const on = this.play.patternIndex === p.patternIndex;
      const x = (this.play.local + this.play.frac) * this.cellW;
      g.strokeStyle = on ? t.playhead : withAlpha(t.playhead, 0.3);
      g.lineWidth = 2;
      g.globalAlpha = on ? 0.9 : 0.4;
      g.beginPath();
      g.moveTo(x, r0 * this.rowH);
      g.lineTo(x, r1 * this.rowH);
      g.stroke();
      g.globalAlpha = 1;
    }
    g.restore();

    this.drawGutter(r0, r1, sy);
    this.drawRuler(c0, c1, sx, bar, spb);

    // corner
    g.fillStyle = t.bg2;
    g.fillRect(0, 0, this.gutter, this.ruler);
    g.strokeStyle = t.line;
    g.beginPath();
    g.moveTo(0, this.ruler - 0.5);
    g.lineTo(this.w, this.ruler - 0.5);
    g.moveTo(this.gutter - 0.5, 0);
    g.lineTo(this.gutter - 0.5, this.h);
    g.stroke();
  }

  colorForMelodyRow(track, row) {
    const pitches = this.getPitchList();
    const pitch = pitches[Math.min(pitches.length - 1, Math.max(0, row))];
    return pitch ? pitchColor(pitch.pc, pitch.octave, this.store.project.octaves) : track.color;
  }

  drawGutter(r0, r1, sy) {
    const g = this.ctx;
    const t = this.theme;
    const p = this.store.project;
    g.save();
    g.beginPath();
    g.rect(0, this.ruler, this.gutter, this.h - this.ruler);
    g.clip();
    g.fillStyle = t.bg2;
    g.fillRect(0, this.ruler, this.gutter, this.h - this.ruler);
    g.translate(0, this.ruler - sy);
    g.textBaseline = 'middle';
    g.font = `500 ${Math.min(11, Math.max(8, this.rowH * 0.62))}px ${getComputedStyle(document.body).fontFamily}`;

    for (let r = r0; r < r1; r++) {
      const row = this.rows[r];
      const y = r * this.rowH;
      g.fillStyle = withAlpha(row.color, row.type === 'fold' ? 0.2 : 0.1);
      g.fillRect(0, y, this.gutter, this.rowH);
      // colour chip
      g.fillStyle = row.color;
      g.globalAlpha = row.track.id === p.selected ? 1 : 0.45;
      g.fillRect(0, y + 1, 3, this.rowH - 2);
      g.globalAlpha = 1;

      if (this.rowH >= 11 && (p.showLabels || row.type !== 'melody')) {
        const label = row.type === 'melody' && !p.showLabels ? '' : row.label;
        g.fillStyle = row.track.id === p.selected ? t.text : t.faint;
        g.fillText(fit(g, label, this.gutter - 12), 8, y + this.rowH / 2 + 0.5);
      }
      if (row.first) {
        g.strokeStyle = t.bar;
        g.beginPath();
        g.moveTo(0, Math.round(y) + 0.5);
        g.lineTo(this.gutter, Math.round(y) + 0.5);
        g.stroke();
      }
    }
    g.restore();
  }

  drawRuler(c0, c1, sx, bar, spb) {
    const g = this.ctx;
    const t = this.theme;
    g.save();
    g.beginPath();
    g.rect(this.gutter, 0, this.w - this.gutter, this.ruler);
    g.clip();
    g.fillStyle = t.bg2;
    g.fillRect(this.gutter, 0, this.w - this.gutter, this.ruler);
    g.translate(this.gutter - sx, 0);
    g.textBaseline = 'middle';
    g.font = `600 10.5px ${getComputedStyle(document.body).fontFamily}`;

    for (let c = c0; c <= c1; c++) {
      const x = c * this.cellW;
      if (c % bar === 0) {
        g.strokeStyle = t.bar;
        g.beginPath();
        g.moveTo(Math.round(x) + 0.5, 4);
        g.lineTo(Math.round(x) + 0.5, this.ruler);
        g.stroke();
        g.fillStyle = t.dim;
        g.fillText(String(c / bar + 1), x + 4, this.ruler / 2 + 1);
      } else if (c % spb === 0 && this.cellW > 16) {
        g.strokeStyle = t.beat;
        g.beginPath();
        g.moveTo(Math.round(x) + 0.5, this.ruler - 6);
        g.lineTo(Math.round(x) + 0.5, this.ruler);
        g.stroke();
      }
    }

    if (this.play) {
      const x = (this.play.local + this.play.frac) * this.cellW;
      g.fillStyle = t.playhead;
      g.beginPath();
      g.moveTo(x - 4, 3);
      g.lineTo(x + 4, 3);
      g.lineTo(x, 10);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  /* ----------------------------- playhead ----------------------------- */

  setPlay(pos) {
    const had = !!this.play;
    this.play = pos;
    if (pos && this.contentW > this.viewW) this.follow(pos);
    if (pos || had) this.invalidate();
  }

  follow(pos) {
    const x = (pos.local + pos.frac) * this.cellW;
    const left = this.scroller.scrollLeft;
    if (x < left + this.cellW || x > left + this.viewW - this.cellW * 2) {
      this.scroller.scrollLeft = Math.max(0, x - this.viewW * 0.35);
    }
  }

  /* ---------------------------- interaction ---------------------------- */

  _pos(e) {
    const rect = this.scroller.getBoundingClientRect();
    const x = e.clientX - rect.left + this.scroller.scrollLeft;
    const y = e.clientY - rect.top + this.scroller.scrollTop;
    const p = this.store.project;
    return {
      step: Math.max(0, Math.min(totalSteps(p) - 1, Math.floor(x / this.cellW))),
      visual: Math.max(0, Math.min(this.rows.length - 1, Math.floor(y / this.rowH))),
      x, y,
    };
  }

  _onWheel(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.setZoom(this.zoom * (e.deltaY < 0 ? 1.12 : 0.89));
  }

  setZoom(z) {
    this.zoom = Math.max(0.55, Math.min(2.6, z));
    this.layout();
    this.invalidate();
  }

  _onDown(e) {
    if (e.button === 1) return;
    const p = this.store.project;
    const hit = this._pos(e);
    const row = this.rows[hit.visual];
    if (!row) return;

    this.scroller.setPointerCapture?.(e.pointerId);
    this.hooks.onFirstTouch?.();

    // Folded track: one tap unfolds it.
    if (row.type === 'fold') {
      this.store.snapshot('fold');
      row.track.collapsed = false;
      this.store.endGesture();
      this.hooks.onTracksChanged?.();
      return;
    }

    if (row.track.id !== p.selected) {
      p.selected = row.track.id;
      this.hooks.onSelectTrack?.(row.track.id);
    }

    const tool = this.store.ui.tool;
    const boxSelect = tool === 'select' || e.shiftKey;
    const notes = notesOf(activePattern(p), row.track.id);
    const existing = noteAt(notes, hit.step, row.row);

    if (boxSelect) {
      this.drag = { mode: 'select', anchor: hit };
      this.store.ui.selection = { r0: hit.visual, r1: hit.visual, s0: hit.step, s1: hit.step };
      this.invalidate();
      return;
    }

    if (tool === 'erase' || e.button === 2) {
      this.store.snapshot('erase');
      this.drag = { mode: 'erase', last: null };
      this._eraseAt(row, hit.step);
      return;
    }

    if (existing) {
      if (e.altKey) {
        this.store.snapshot('velocity');
        const i = VEL_STEPS.findIndex((v) => Math.abs(v - (existing.v ?? 0.85)) < 0.06);
        existing.v = VEL_STEPS[(i + 1 + VEL_STEPS.length) % VEL_STEPS.length];
        this.store.endGesture();
        this.hooks.onEdit?.();
        this.invalidate();
        return;
      }
      // Tapping a note removes it; dragging on rubs out more.
      this.store.snapshot('erase');
      this.drag = { mode: 'erase', last: null };
      this._eraseAt(row, hit.step);
      return;
    }

    this.store.snapshot('draw');
    this.store.ui.selection = null;
    const note = { s: hit.step, p: row.row, l: 1, v: 0.85 };
    notes.push(note);
    this.drag = { mode: 'draw', anchor: hit, note, row, painted: new Set([`${row.row}:${hit.step}`]) };
    this.hooks.onPreview?.(row.track, row.row, note.v);
    this.hooks.onEdit?.();
    this.invalidate();
  }

  _onMove(e) {
    if (!this.drag) return;
    const p = this.store.project;
    const hit = this._pos(e);

    if (this.drag.mode === 'select') {
      const a = this.drag.anchor;
      this.store.ui.selection = {
        r0: Math.min(a.visual, hit.visual), r1: Math.max(a.visual, hit.visual),
        s0: Math.min(a.step, hit.step), s1: Math.max(a.step, hit.step),
      };
      this.invalidate();
      return;
    }

    if (this.drag.mode === 'erase') {
      const row = this.rows[hit.visual];
      if (row && row.type !== 'fold') this._eraseAt(row, hit.step);
      return;
    }

    // draw: same row → stretch the note; other rows → keep painting
    const { anchor, note } = this.drag;
    if (hit.visual === anchor.visual && hit.step >= anchor.step) {
      const len = hit.step - anchor.step + 1;
      if (len !== note.l) {
        note.l = len;
        this.hooks.onEdit?.();
        this.invalidate();
      }
      return;
    }
    const target = this.rows[hit.visual];
    if (!target || target.type === 'fold') return;
    const key = `${target.track.id}:${target.row}:${hit.step}`;
    if (this.drag.painted.has(key)) return;
    this.drag.painted.add(key);
    const notes = notesOf(activePattern(p), target.track.id);
    if (!noteAt(notes, hit.step, target.row)) {
      notes.push({ s: hit.step, p: target.row, l: 1, v: 0.85 });
      this.hooks.onPreview?.(target.track, target.row, 0.85);
      this.hooks.onEdit?.();
      this.invalidate();
    }
  }

  _onUp() {
    if (!this.drag) return;
    const wasSelect = this.drag.mode === 'select';
    this.drag = null;
    this.store.endGesture();
    if (wasSelect) {
      const sel = this.store.ui.selection;
      if (sel && sel.s0 === sel.s1 && sel.r0 === sel.r1) this.store.ui.selection = null;
      this.invalidate();
    }
    this.hooks.onEditCommitted?.();
  }

  _eraseAt(row, step) {
    const notes = notesOf(activePattern(this.store.project), row.track.id);
    const hit = noteAt(notes, step, row.row);
    if (!hit) return;
    notes.splice(notes.indexOf(hit), 1);
    this.hooks.onEdit?.();
    this.invalidate();
  }

  /* --------------------------- selection ops --------------------------- */

  /** All notes inside the current selection, grouped by track. */
  selectedGroups() {
    const sel = this.store.ui.selection;
    if (!sel) return [];
    const p = this.store.project;
    const pattern = activePattern(p);
    const out = [];
    for (let v = sel.r0; v <= sel.r1; v++) {
      const row = this.rows[v];
      if (!row || row.type === 'fold') continue;
      const notes = notesOf(pattern, row.track.id);
      const found = notes.filter((n) => n.p === row.row && n.s >= sel.s0 && n.s <= sel.s1);
      if (!found.length) continue;
      let group = out.find((x) => x.trackId === row.track.id);
      if (!group) {
        group = { trackId: row.track.id, track: row.track, notes: [], all: notes };
        out.push(group);
      }
      group.notes.push(...found);
    }
    return out;
  }

  deleteSelection() {
    const groups = this.selectedGroups();
    if (!groups.length) return false;
    this.store.snapshot('delete');
    for (const g of groups) {
      for (const n of g.notes) {
        const i = g.all.indexOf(n);
        if (i >= 0) g.all.splice(i, 1);
      }
    }
    this.store.endGesture();
    this.invalidate();
    return true;
  }

  copySelection() {
    const groups = this.selectedGroups();
    const sel = this.store.ui.selection;
    if (!groups.length || !sel) return false;
    this.store.ui.clipboard = {
      s0: sel.s0,
      items: groups.map((g) => ({
        trackId: g.trackId,
        notes: g.notes.map((n) => ({ ...n })),
      })),
    };
    return true;
  }

  pasteClipboard(atStep = null) {
    const clip = this.store.ui.clipboard;
    if (!clip) return false;
    const p = this.store.project;
    const pattern = activePattern(p);
    const steps = totalSteps(p);
    const target = atStep == null ? (this.store.ui.selection?.s0 ?? clip.s0) : atStep;
    const shift = target - clip.s0;
    this.store.snapshot('paste');
    for (const item of clip.items) {
      const track = p.tracks.find((t) => t.id === item.trackId) || findTrack(p, p.selected);
      const notes = notesOf(pattern, track.id);
      for (const n of item.notes) {
        const s = n.s + shift;
        if (s < 0 || s >= steps) continue;
        const existing = noteAt(notes, s, n.p);
        if (existing) notes.splice(notes.indexOf(existing), 1);
        notes.push({ ...n, s });
      }
    }
    this.store.endGesture();
    this.invalidate();
    return true;
  }

  /** Move the selection by rows (pitch) and/or steps (time). */
  moveSelection(dRow, dStep) {
    const groups = this.selectedGroups();
    const sel = this.store.ui.selection;
    if (!groups.length || !sel) return false;
    const p = this.store.project;
    const steps = totalSteps(p);
    this.store.snapshot('move');
    for (const g of groups) {
      const lane = this.trackLanes.get(g.trackId);
      const maxRow = lane ? lane.count - 1 : 0;
      for (const n of g.notes) {
        // Visually up = a higher pitch = a larger row index.
        n.p = Math.max(0, Math.min(maxRow, n.p - dRow));
        n.s = Math.max(0, Math.min(steps - 1, n.s + dStep));
      }
    }
    this.store.endGesture();
    this.store.ui.selection = {
      ...sel,
      r0: Math.max(0, sel.r0 + dRow), r1: Math.min(this.rows.length - 1, sel.r1 + dRow),
      s0: Math.max(0, sel.s0 + dStep), s1: Math.min(steps - 1, sel.s1 + dStep),
    };
    this.invalidate();
    return true;
  }

  selectAll() {
    const p = this.store.project;
    this.store.ui.selection = { r0: 0, r1: Math.max(0, this.rows.length - 1), s0: 0, s1: totalSteps(p) - 1 };
    this.invalidate();
  }

  clearSelection() {
    this.store.ui.selection = null;
    this.invalidate();
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this._ro?.disconnect();
  }
}

/* ------------------------------- helpers ------------------------------- */

function roundRect(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

function fit(g, text, maxWidth) {
  if (!text) return '';
  if (g.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && g.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

/** Accepts hex or hsl() and returns the same colour with an alpha applied. */
function withAlpha(color, alpha) {
  const c = color.trim();
  if (c.startsWith('#')) {
    const hex = c.length === 4
      ? c.slice(1).split('').map((x) => x + x).join('')
      : c.slice(1, 7);
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  if (c.startsWith('hsl(')) return c.replace('hsl(', 'hsla(').replace(')', ` / ${alpha})`);
  if (c.startsWith('rgb(')) return c.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
  return c;
}
