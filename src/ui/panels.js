/* Slide-over panels: song settings, mixer/FX, share/export, help. */

import { SCALES, NOTE_NAMES, NOTE_NAMES_FLAT, buildPitchList } from '../core/scales.js';
import { THEMES, instrumentName, rescaleNotes, remapNotesToLadder } from '../core/project.js';

const PANELS = ['settings', 'mixer', 'export', 'help'];

export class Panels {
  constructor({ store, hooks }) {
    this.store = store;
    this.hooks = hooks;
    this.open = null;
    this.scrim = document.getElementById('scrim');
    this.els = {};
    for (const name of PANELS) this.els[name] = document.getElementById('panel-' + name);

    document.querySelectorAll('[data-panel]').forEach((btn) => {
      btn.addEventListener('click', () => this.toggle(btn.dataset.panel));
    });
    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => this.close());
    });
    this.scrim.addEventListener('click', () => this.close());

    this.buildSettings();
    this.buildMixer();
  }

  toggle(name) {
    if (this.open === name) return this.close();
    this.close();
    const el = this.els[name];
    if (!el) return;
    el.hidden = false;
    this.scrim.hidden = false;
    this.open = name;
    if (name === 'settings') this.syncSettings();
    if (name === 'mixer') this.syncMixer();
    this.hooks.onOpen?.(name);
  }

  close() {
    if (!this.open) return;
    this.els[this.open].hidden = true;
    this.scrim.hidden = true;
    this.open = null;
  }

  /* --------------------------- song settings --------------------------- */

  buildSettings() {
    const $ = (id) => document.getElementById(id);
    this.s = {
      scale: $('set-scale'), root: $('set-root'), octave: $('set-octave'), octaves: $('set-octaves'),
      bars: $('set-bars'), beats: $('set-beats'), splits: $('set-splits'),
      swing: $('set-swing'), humanize: $('set-humanize'),
      outSwing: $('out-swing'), outHumanize: $('out-humanize'),
      theme: $('set-theme'), labels: $('set-labels'), accidentals: $('set-accidentals'),
    };

    fill(this.s.scale, SCALES.map((s) => [s.id, s.name]));
    this.fillRoots();
    fill(this.s.octave, [2, 3, 4, 5, 6].map((n) => [n, `Octave ${n}`]));
    fill(this.s.octaves, [1, 2, 3, 4].map((n) => [n, n === 1 ? '1 octave' : `${n} octaves`]));
    fill(this.s.bars, range(1, 16).map((n) => [n, String(n)]));
    fill(this.s.beats, range(1, 12).map((n) => [n, String(n)]));
    const SPLIT_LABELS = { 1: 'Whole beats', 2: 'Halves (8ths)', 3: 'Triplets', 4: 'Quarters (16ths)', 6: 'Sixths' };
    fill(this.s.splits, [1, 2, 3, 4, 6].map((n) => [n, SPLIT_LABELS[n]]));
    fill(this.s.theme, THEMES.map((t) => [t.id, t.name]));

    const layoutFields = ['scale', 'root', 'octave', 'octaves', 'bars', 'beats', 'splits'];
    const keyMap = { beats: 'beatsPerBar' };
    for (const f of layoutFields) {
      this.s[f].addEventListener('change', () => {
        const p = this.store.project;
        this.store.snapshot('setting-' + f);
        const key = keyMap[f] || f;
        const raw = this.s[f].value;
        const value = /^\d+$/.test(raw) ? Number(raw) : raw;
        // A finer or coarser subdivision should keep the rhythm, not shift it.
        if (f === 'splits' && value !== p.splits) rescaleNotes(p, value / p.splits);
        p[key] = value;
        this.store.endGesture();
        this.hooks.onLayout();
      });
    }

    const feel = (el, key, out) => {
      el.addEventListener('input', () => {
        const p = this.store.project;
        this.store.snapshot('feel-' + key);
        p[key] = Number(el.value);
        out.textContent = Math.round(p[key] * 100) + '%';
        this.hooks.onFeel();
      });
      el.addEventListener('change', () => this.store.endGesture());
    };
    feel(this.s.swing, 'swing', this.s.outSwing);
    feel(this.s.humanize, 'humanize', this.s.outHumanize);

    this.s.theme.addEventListener('change', () => {
      this.store.project.theme = this.s.theme.value;
      this.hooks.onTheme();
    });

    this.s.labels.addEventListener('change', () => {
      const p = this.store.project;
      const mode = this.s.labels.value;
      this.store.snapshot('labels');
      p.showLabels = mode !== 'off';
      if (mode !== 'off') p.useFlats = mode === 'flat';
      this.store.endGesture();
      this.fillRoots();
      this.hooks.onLayout();
    });

    // Adding or removing the accidental rows renumbers every row, so the
    // notes move with their pitches instead of jumping to new ones.
    this.s.accidentals.addEventListener('change', () => {
      const p = this.store.project;
      const next = this.s.accidentals.value === '1';
      if (next === !!p.accidentals) return;
      this.store.snapshot('accidentals');
      const before = buildPitchList(p);
      p.accidentals = next;
      remapNotesToLadder(p, before, buildPitchList(p));
      this.store.endGesture();
      this.hooks.onLayout();
    });
  }

  /** Root names follow the sharp/flat preference; the stored value stays sharp. */
  fillRoots() {
    const p = this.store.project;
    const names = p.useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES;
    const current = this.s.root.value || p.root;
    fill(this.s.root, NOTE_NAMES.map((n, i) => [n, names[i]]));
    this.s.root.value = NOTE_NAMES.includes(current) ? current : p.root;
  }

  syncSettings() {
    const p = this.store.project;
    this.s.scale.value = p.scale;
    this.s.root.value = p.root;
    this.s.octave.value = String(p.octave);
    this.s.octaves.value = String(p.octaves);
    this.s.bars.value = String(p.bars);
    this.s.beats.value = String(p.beatsPerBar);
    this.s.splits.value = String(p.splits);
    this.s.swing.value = String(p.swing);
    this.s.humanize.value = String(p.humanize);
    this.s.outSwing.textContent = Math.round(p.swing * 100) + '%';
    this.s.outHumanize.textContent = Math.round(p.humanize * 100) + '%';
    this.s.theme.value = p.theme;
    this.s.labels.value = p.showLabels ? (p.useFlats ? 'flat' : 'sharp') : 'off';
    this.s.accidentals.value = p.accidentals ? '1' : '0';
    this.fillRoots();
    this.s.root.value = p.root;
  }

  /* ------------------------------- mixer ------------------------------- */

  buildMixer() {
    const $ = (id) => document.getElementById(id);
    this.m = {
      strips: $('mixer-strips'),
      reverb: $('fx-reverb'), reverbSize: $('fx-reverb-size'), delay: $('fx-delay'),
      delayTime: $('fx-delay-time'), tone: $('fx-tone'), drive: $('fx-drive'),
      chorus: $('fx-chorus'), master: $('fx-master'), reset: $('fx-reset'),
    };
    this.mOut = {
      reverb: $('out-reverb'), reverbSize: $('out-reverb-size'), delay: $('out-delay'),
      tone: $('out-tone'), drive: $('out-drive'), chorus: $('out-chorus'), master: $('out-master'),
    };

    for (const key of ['reverb', 'reverbSize', 'delay', 'tone', 'drive', 'chorus', 'master']) {
      this.m[key].addEventListener('input', () => {
        this.store.snapshot('fx-' + key);
        this.store.project.fx[key] = Number(this.m[key].value);
        this.mOut[key].textContent = Math.round(Number(this.m[key].value) * 100) + '%';
        this.hooks.onFx();
      });
      this.m[key].addEventListener('change', () => this.store.endGesture());
    }
    this.m.delayTime.addEventListener('change', () => {
      this.store.snapshot('fx-delayTime');
      this.store.project.fx.delayTime = Number(this.m.delayTime.value);
      this.store.endGesture();
      this.hooks.onFx();
    });
    this.m.reset.addEventListener('click', () => {
      this.store.snapshot('fx-reset');
      Object.assign(this.store.project.fx, {
        reverb: 0.22, reverbSize: 0.6, delay: 0, delayTime: 0.5, tone: 1, drive: 0.08, chorus: 0.15,
      });
      this.store.endGesture();
      this.syncMixer();
      this.hooks.onFx();
    });

    this.m.strips.addEventListener('input', (e) => {
      const strip = e.target.closest('[data-track]');
      if (!strip) return;
      const track = this.store.project.tracks.find((t) => t.id === strip.dataset.track);
      if (!track) return;
      const field = e.target.dataset.field;
      this.store.snapshot(`strip-${field}-${track.id}`);
      const value = Number(e.target.value);
      if (field === 'vol') track.volume = value;
      else if (field === 'pan') track.pan = value;
      else if (field === 'oct') track.octaveShift = value;
      const out = e.target.parentElement.querySelector('output');
      if (out) out.textContent = formatStrip(field, value);
      this.hooks.onMix(field === 'oct');
    });
    this.m.strips.addEventListener('change', () => this.store.endGesture());
  }

  syncMixer() {
    const p = this.store.project;
    for (const key of ['reverb', 'reverbSize', 'delay', 'tone', 'drive', 'chorus', 'master']) {
      this.m[key].value = String(p.fx[key]);
      this.mOut[key].textContent = Math.round(p.fx[key] * 100) + '%';
    }
    this.m.delayTime.value = String(p.fx.delayTime);
    this.m.strips.innerHTML = p.tracks.map((t) => `
      <div class="strip" data-track="${t.id}" style="--tc:${t.color}">
        <div class="strip-top"><span>${esc(t.name)}</span><small>${esc(instrumentName(t))}</small></div>
        <label class="slider-row"><span>Level</span><input type="range" data-field="vol" min="0" max="1" step="0.01" value="${t.volume}"><output>${formatStrip('vol', t.volume)}</output></label>
        <label class="slider-row"><span>Pan</span><input type="range" data-field="pan" min="-1" max="1" step="0.02" value="${t.pan || 0}"><output>${formatStrip('pan', t.pan || 0)}</output></label>
        ${t.type === 'melody'
          ? `<label class="slider-row"><span>Octave</span><input type="range" data-field="oct" min="-2" max="2" step="1" value="${t.octaveShift || 0}"><output>${formatStrip('oct', t.octaveShift || 0)}</output></label>`
          : ''}
      </div>`).join('');
  }
}

function formatStrip(field, v) {
  if (field === 'vol') return Math.round(v * 100) + '%';
  if (field === 'pan') return v === 0 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100);
  return (v > 0 ? '+' : '') + v;
}

function fill(select, pairs) {
  select.innerHTML = pairs.map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join('');
}

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
