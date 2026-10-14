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
  MAX_BARS, rangeRoom,
} from '../core/project.js';
import { pitchColor } from '../core/scales.js';

const MIN_CELL = 15;
const MAX_CELL = 58;
const MIN_ROW = 12;
const MAX_ROW = 34;
const EXTEND_W = 48;      // the "+ bar" column after the last bar
const MIN_ZOOM = 0.3;     // far enough out to see a long song at a glance
const MAX_ZOOM = 2.6;

/** Rows that hold notes, as opposed to folded lanes and "+ more notes" rows. */
const isNoteRow = (row) => !!row && (row.type === 'melody' || row.type === 'drum');

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

    // The bar ruler is outside the scroll layer, so the canvas handles it.
    canvas.addEventListener('pointerdown', (e) => this._onRulerDown(e));
    canvas.addEventListener('pointermove', (e) => this._onRulerMove(e));
    canvas.addEventListener('pointerup', (e) => this._onRulerUp(e));
    canvas.addEventListener('pointercancel', (e) => this._onRulerUp(e));
    canvas.addEventListener('pointerleave', () => {
      if (this.rulerHover || this.rulerExtendHover) {
        this.rulerHover = false;
        this.rulerExtendHover = false;
        this.invalidate();
      }
    });
    // Scrolling over the labels moves the grid: the ruler sideways, the
    // gutter up and down.
    canvas.addEventListener('wheel', (e) => this._onChromeWheel(e), { passive: false });
  }

  /* --------------------------- ruler scrubbing --------------------------- */

  /** Grid step under the pointer, or null when it is not over the ruler. */
  _rulerStep(e) {
    const rect = this.stage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (y < 0 || y > this.ruler || x < this.gutter) return null;
    const step = Math.floor((x - this.gutter + this.scroller.scrollLeft) / this.cellW);
    return Math.max(0, Math.min(totalSteps(this.store.project) - 1, step));
  }

  /** Pointer position relative to the stage, plus what lies under it. */
  _chromeHit(e) {
    const rect = this.stage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const contentX = x - this.gutter + this.scroller.scrollLeft;
    return {
      x, y,
      inRuler: y >= 0 && y <= this.ruler && x >= this.gutter,
      inGutter: x >= 0 && x < this.gutter && y > this.ruler,
      inExtend: this.extendW > 0 && contentX >= this.contentW && contentX < this.contentW + this.extendW,
      row: this.rows[Math.floor((y - this.ruler + this.scroller.scrollTop) / this.rowH)],
    };
  }

  _onRulerDown(e) {
    const hit = this._chromeHit(e);
    if (hit.inRuler && hit.inExtend) {
      e.preventDefault();
      this.extendSong();
      return;
    }
    if (hit.inGutter && hit.row) {
      e.preventDefault();
      this.hooks.onFirstTouch?.();
      if (hit.row.type === 'more') this.hooks.onMoreNotes?.(hit.row.dir);
      else if (isNoteRow(hit.row)) this.hooks.onPreview?.(hit.row.track, hit.row.row, 0.85);
      return;
    }
    const step = this._rulerStep(e);
    if (step == null) return;
    e.preventDefault();
    this.scrubbing = true;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.hooks.onScrub?.(step);
  }

  _onRulerMove(e) {
    if (this.scrubbing) {
      const rect = this.stage.getBoundingClientRect();
      const x = e.clientX - rect.left - this.gutter + this.scroller.scrollLeft;
      const step = Math.max(0, Math.min(totalSteps(this.store.project) - 1, Math.floor(x / this.cellW)));
      this.hooks.onScrub?.(step);
      return;
    }
    const hit = this._chromeHit(e);
    const extendHover = hit.inRuler && hit.inExtend;
    if (extendHover !== !!this.rulerExtendHover) {
      this.rulerExtendHover = extendHover;
      this.invalidate();
    }
    const over = this._rulerStep(e) != null && !extendHover;
    this.canvas.style.cursor = hit.inRuler && hit.inExtend ? 'pointer'
      : over ? 'ew-resize'
        : hit.inGutter && hit.row && hit.row.type !== 'fold' ? 'pointer' : '';
    if (over !== this.rulerHover) {
      this.rulerHover = over;
      this.invalidate();
    }
  }

  _onChromeWheel(e) {
    const hit = this._chromeHit(e);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.12 : 0.89));
      return;
    }
    if (hit.inRuler) {
      e.preventDefault();
      this.scroller.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    } else if (hit.inGutter) {
      e.preventDefault();
      this.scroller.scrollTop += e.deltaY;
    }
  }

  /**
   * Add a bar to the end of the song and keep the "+" column in view, so
   * clicking it again and again keeps going.
   */
  extendSong(placeNote = null) {
    const p = this.store.project;
    if (p.bars >= MAX_BARS) return false;
    const firstNewStep = totalSteps(p);
    this.store.snapshot('extend');
    this.hooks.onExtend?.(1);
    if (placeNote) {
      notesOf(activePattern(p), placeNote.track.id).push({ s: firstNewStep, p: placeNote.row, l: 1, v: 0.85 });
      this.hooks.onPreview?.(placeNote.track, placeNote.row, 0.85);
      this.hooks.onEdit?.();
    }
    this.store.endGesture();
    if (this.contentW + this.extendW > this.viewW) {
      this.scroller.scrollLeft = this.scroller.scrollWidth;
    }
    this.invalidate();
    return true;
  }

  _onRulerUp(e) {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    this.canvas.releasePointerCapture?.(e.pointerId);
    this.hooks.onScrubEnd?.();
    this.invalidate();
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
    const room = rangeRoom(p);

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
        // Each melody lane is bracketed by rows that add an octave of notes
        // above or below, until the ladder reaches the edge of the piano.
        if (room.up) {
          this.rows.push({ track, type: 'more', dir: 1, label: '+ higher', color: track.color, first: true });
        }
        const pitchBase = this.rows.length;
        for (let i = pitches.length - 1; i >= 0; i--) {
          const pitch = pitches[i];
          this.rows.push({
            track, type: 'melody', row: i,
            label: pitch.name, color: pitchColor(pitch.pc, pitch.octave, p.octaves),
            root: pitch.degree === 0,
            accidental: pitch.inScale === false,
            first: !room.up && i === pitches.length - 1, last: !room.down && i === 0,
          });
        }
        if (room.down) {
          this.rows.push({ track, type: 'more', dir: -1, label: '+ lower', color: track.color, last: true });
        }
        this.trackLanes.set(track.id, { base: pitchBase, count: pitches.length, collapsed: false, track });
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

    // A short song stretches to fill the view, minus a column for "+ bar"
    // so there is always somewhere to click to make it longer.
    this.extendW = p.bars < MAX_BARS ? EXTEND_W : 0;
    const fitCell = Math.max(1, viewW - this.extendW) / steps;
    this.cellW = Math.max(MIN_CELL * this.zoom, Math.min(MAX_CELL * this.zoom, fitCell));
    // Zooming out squeezes time, not pitch: rows stay tall enough to hit.
    const rowZoom = Math.max(0.8, this.zoom);
    const fitRow = viewH / rows;
    this.rowH = Math.max(MIN_ROW * rowZoom, Math.min(MAX_ROW * rowZoom, fitRow));

    this.contentW = steps * this.cellW;
    this.contentH = rows * this.rowH;
    this.viewW = viewW;
    this.viewH = viewH;
    this.spacer.style.width = Math.round(this.contentW + this.extendW) + 'px';
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

    // Beat stripes are the same on every row, so paint them once — a long,
    // zoomed-out song would otherwise be thousands of rectangles per frame.
    const top = r0 * this.rowH;
    const bottom = r1 * this.rowH;
    g.fillStyle = t.cell;
    g.fillRect(c0 * this.cellW, top, (c1 - c0) * this.cellW, bottom - top);
    g.fillStyle = t.cellAlt;
    for (let b = Math.floor(c0 / spb); b * spb < c1; b++) {
      if (b % 2 === 0) continue;
      const span = Math.min(spb, steps - b * spb);
      g.fillRect(b * spb * this.cellW, top, span * this.cellW, bottom - top);
    }

    for (let r = r0; r < r1; r++) {
      const row = this.rows[r];
      const y = r * this.rowH;
      const selTrack = row.track.id === p.selected;
      if (row.type === 'more') {
        g.fillStyle = withAlpha(t.bg, 0.55);
        g.fillRect(c0 * this.cellW, y, (c1 - c0) * this.cellW, this.rowH);
        continue;
      }
      if (row.type === 'fold') {
        g.fillStyle = withAlpha(row.color, 0.06);
        g.fillRect(c0 * this.cellW, y, (c1 - c0) * this.cellW, this.rowH);
      } else if (row.accidental) {
        // Sharps and flats sit back like the black keys of a piano.
        g.fillStyle = withAlpha(t.bg, 0.42);
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

    // grid lines — they thin out as the view zooms out
    g.lineWidth = 1;
    const barEvery = this.barStride(5);
    const beatW = spb * this.cellW;
    for (let c = c0; c <= c1; c++) {
      const x = Math.round(c * this.cellW) + 0.5;
      const isBar = c % bar === 0;
      const isBeat = c % spb === 0;
      if (isBar) {
        if ((c / bar) % barEvery !== 0 && c !== steps) continue;
      } else if (isBeat) {
        if (beatW < 6) continue;
      } else if (this.cellW < 11) {
        continue;
      }
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
        if (note.s >= steps) continue;          // past the end: kept, not shown
        const len = Math.min(Math.max(1, note.l || 1), steps - note.s);
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
      g.lineWidth = this.play.paused ? 1.5 : 2;
      g.globalAlpha = on ? (this.play.paused ? 0.55 : 0.9) : 0.35;
      if (this.play.paused) g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(x, r0 * this.rowH);
      g.lineTo(x, r1 * this.rowH);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }

    this.drawExtensions(sx, sy, r0, r1);
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

  /** The "+ bar" column after the end, and the words on the "+ notes" rows. */
  drawExtensions(sx, sy, r0, r1) {
    const g = this.ctx;
    const t = this.theme;
    const font = getComputedStyle(document.body).fontFamily;

    for (let r = r0; r < r1; r++) {
      const row = this.rows[r];
      if (row.type !== 'more') continue;
      const y = r * this.rowH;
      g.fillStyle = withAlpha(t.accent, 0.75);
      g.textBaseline = 'middle';
      g.font = `600 ${Math.min(11.5, Math.max(9, this.rowH * 0.6))}px ${font}`;
      const text = row.dir > 0 ? '+  Add higher notes' : '+  Add lower notes';
      g.fillText(text, sx + 10, y + this.rowH / 2 + 0.5);
    }

    if (!this.extendW || this.contentW > sx + this.viewW) return;
    const x = this.contentW;
    const h = Math.min(this.contentH, sy + this.viewH);
    g.fillStyle = withAlpha(t.accent, 0.06);
    g.fillRect(x, 0, this.extendW, h);
    g.strokeStyle = withAlpha(t.accent, 0.5);
    g.setLineDash([4, 4]);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(x) + 0.5, 0);
    g.lineTo(Math.round(x) + 0.5, h);
    g.stroke();
    g.setLineDash([]);

    // Keep the plus centred in whatever part of the column is on screen.
    const cy = sy + Math.min(this.viewH, this.contentH - sy) / 2;
    g.fillStyle = withAlpha(t.accent, 0.9);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `300 26px ${font}`;
    g.fillText('+', x + this.extendW / 2, cy - 7);
    g.font = `600 10px ${font}`;
    g.fillText('bar', x + this.extendW / 2, cy + 12);
    g.textAlign = 'left';
  }

  /** Smallest power-of-two count of bars that spans at least `minPx`. */
  barStride(minPx) {
    const barW = stepsPerBar(this.store.project) * this.cellW;
    let every = 1;
    while (barW * every < minPx && every < 4096) every *= 2;
    return every;
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
      if (row.type === 'more') {
        g.fillStyle = withAlpha(t.accent, 0.08);
        g.fillRect(0, y, this.gutter, this.rowH);
        if (this.rowH >= 9) {
          g.fillStyle = t.accent;
          g.fillText(fit(g, row.label, this.gutter - 10), 6, y + this.rowH / 2 + 0.5);
        }
        if (row.first) {
          g.strokeStyle = t.bar;
          g.beginPath();
          g.moveTo(0, Math.round(y) + 0.5);
          g.lineTo(this.gutter, Math.round(y) + 0.5);
          g.stroke();
        }
        continue;
      }
      g.fillStyle = row.accidental
        ? withAlpha(t.bg, 0.5)
        : withAlpha(row.color, row.type === 'fold' ? 0.2 : 0.1);
      g.fillRect(0, y, this.gutter, this.rowH);
      // colour chip
      g.fillStyle = row.color;
      g.globalAlpha = (row.track.id === p.selected ? 1 : 0.45) * (row.accidental ? 0.5 : 1);
      g.fillRect(0, y + 1, 3, this.rowH - 2);
      g.globalAlpha = row.accidental ? 0.6 : 1;

      if (this.rowH >= 11 && (p.showLabels || row.type !== 'melody')) {
        const label = row.type === 'melody' && !p.showLabels ? '' : row.label;
        g.fillStyle = row.accidental ? t.faint
          : (row.track.id === p.selected ? t.text : t.faint);
        g.fillText(fit(g, label, this.gutter - 12), 8, y + this.rowH / 2 + 0.5);
      }
      g.globalAlpha = 1;
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

    const steps = totalSteps(this.store.project);
    const tickEvery = this.barStride(5);
    const labelEvery = this.barStride(32);
    for (let c = c0; c <= c1; c++) {
      const x = c * this.cellW;
      if (c % bar === 0) {
        const index = c / bar;
        if (index % tickEvery !== 0 && c !== steps) continue;
        g.strokeStyle = t.bar;
        g.beginPath();
        g.moveTo(Math.round(x) + 0.5, index % labelEvery === 0 ? 4 : this.ruler - 8);
        g.lineTo(Math.round(x) + 0.5, this.ruler);
        g.stroke();
        if (index % labelEvery === 0 && c < steps) {
          g.fillStyle = t.dim;
          g.fillText(String(index + 1), x + 4, this.ruler / 2 + 1);
        }
      } else if (c % spb === 0 && this.cellW > 16) {
        g.strokeStyle = t.beat;
        g.beginPath();
        g.moveTo(Math.round(x) + 0.5, this.ruler - 6);
        g.lineTo(Math.round(x) + 0.5, this.ruler);
        g.stroke();
      }
    }

    if (this.extendW && this.contentW < sx + this.w) {
      const x = this.contentW;
      g.fillStyle = withAlpha(t.accent, this.rulerExtendHover ? 0.22 : 0.1);
      g.fillRect(x + 1, 3, this.extendW - 2, this.ruler - 6);
      g.fillStyle = t.accent;
      g.textAlign = 'center';
      g.fillText('+ bar', x + this.extendW / 2, this.ruler / 2 + 1);
      g.textAlign = 'left';
    }

    if (this.play) {
      // Paused or hovered, the marker grows into something you can grab.
      const x = (this.play.local + this.play.frac) * this.cellW;
      const big = this.play.paused || this.scrubbing || this.rulerHover;
      const w = big ? 7 : 4.5;
      g.fillStyle = this.play.patternIndex === this.store.project.patternIndex
        ? t.playhead : withAlpha(t.playhead, 0.4);
      g.beginPath();
      g.moveTo(x - w, 2);
      g.lineTo(x + w, 2);
      g.lineTo(x, big ? 14 : 10);
      g.closePath();
      g.fill();
      if (big) {
        g.strokeStyle = t.bg2;
        g.lineWidth = 1;
        g.stroke();
      }
    }
    g.restore();
  }

  /* ----------------------------- playhead ----------------------------- */

  setPlay(pos) {
    const had = !!this.play;
    this.play = pos;
    // Only chase a moving playhead — scrolling under a hand that is dragging
    // the paused one would fight the user.
    if (pos && !pos.paused && this.contentW > this.viewW) this.follow(pos);
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
      inExtend: this.extendW > 0 && x >= this.contentW,
      x, y,
    };
  }

  _onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.12 : 0.89));
      return;
    }
    // Nothing to scroll vertically? Then the wheel travels through the song.
    const vertical = Math.abs(e.deltaY) > Math.abs(e.deltaX);
    if (vertical && !e.shiftKey && this.contentH <= this.viewH + 1) {
      e.preventDefault();
      this.scroller.scrollLeft += e.deltaY;
    }
  }

  setZoom(z) {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
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

    // "+ Add higher / lower notes" rows grow the pitch range.
    if (row.type === 'more') {
      this.hooks.onMoreNotes?.(row.dir);
      return;
    }

    // The "+ bar" column after the end makes the song longer — and drawing
    // into it lands the note at the start of the new bar.
    if (hit.inExtend && e.button !== 2) {
      const drawing = this.store.ui.tool === 'draw' && !e.shiftKey && isNoteRow(row);
      this.extendSong(drawing ? row : null);
      return;
    }

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
      if (isNoteRow(row) && !hit.inExtend) this._eraseAt(row, hit.step);
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
    if (!isNoteRow(target) || hit.inExtend) return;
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
      if (!isNoteRow(row)) continue;
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
