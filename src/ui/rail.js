/* The track rail down the left-hand side. */

import { MELODY_INSTRUMENTS, DRUM_KITS, TRACK_COLORS, createTrack } from '../core/project.js';

export class Rail {
  constructor({ list, addButton, store, hooks }) {
    this.list = list;
    this.store = store;
    this.hooks = hooks;

    addButton.addEventListener('click', () => this.addTrack());

    list.addEventListener('click', (e) => {
      const card = e.target.closest('[data-track]');
      if (!card) return;
      const track = this.store.project.tracks.find((t) => t.id === card.dataset.track);
      if (!track) return;
      const btn = e.target.closest('[data-act]');
      if (btn) {
        e.stopPropagation();
        this.action(btn.dataset.act, track);
        return;
      }
      // Selecting only re-styles the cards. Rebuilding the rail's HTML here
      // would close the native <select> popup the click just opened.
      this.select(track.id);
    });

    list.addEventListener('input', (e) => {
      const card = e.target.closest('[data-track]');
      if (!card) return;
      const track = this.store.project.tracks.find((t) => t.id === card.dataset.track);
      if (!track) return;
      // 'name' and 'vol' deliberately do NOT re-render the rail: that would
      // yank focus out of the field the user is still using.
      if (e.target.matches('[data-field="name"]')) {
        track.name = e.target.value.slice(0, 24);
        this.hooks.onChange('name');
      } else if (e.target.matches('[data-field="vol"]')) {
        this.store.snapshot('vol-' + track.id);
        track.volume = Number(e.target.value);
        this.hooks.onChange('vol');
      }
    });

    list.addEventListener('change', (e) => {
      const card = e.target.closest('[data-track]');
      if (!card) return;
      const track = this.store.project.tracks.find((t) => t.id === card.dataset.track);
      if (!track) return;
      if (e.target.matches('[data-field="inst"]')) {
        this.store.snapshot('inst');
        track.instrument = e.target.value;
        this.store.endGesture();
        // A new kit changes how many rows the track needs.
        this.hooks.onChange(track.type === 'drums' ? 'layout' : 'name');
      }
    });
  }

  action(act, track) {
    const p = this.store.project;
    switch (act) {
      case 'mute':
        this.store.snapshot('mute');
        track.mute = !track.mute;
        if (track.mute) track.solo = false;
        this.store.endGesture();
        this.hooks.onChange('mix');
        break;
      case 'solo':
        this.store.snapshot('solo');
        track.solo = !track.solo;
        if (track.solo) track.mute = false;
        this.store.endGesture();
        this.hooks.onChange('mix');
        break;
      case 'fold':
        this.store.snapshot('fold');
        track.collapsed = !track.collapsed;
        this.store.endGesture();
        this.hooks.onChange('layout');
        break;
      case 'del':
        if (p.tracks.length <= 1) {
          this.hooks.onMessage?.('A song needs at least one track.');
          return;
        }
        this.store.snapshot('del-track');
        p.tracks = p.tracks.filter((t) => t.id !== track.id);
        for (const pat of p.patterns) delete pat.notes[track.id];
        if (p.selected === track.id) p.selected = p.tracks[0].id;
        this.store.endGesture();
        this.hooks.onChange('layout');
        break;
      default:
        break;
    }
  }

  select(id) {
    if (this.store.project.selected === id) return;
    this.store.project.selected = id;
    this.hooks.onChange('select');
  }

  /** Move the selection highlight without rebuilding any DOM. */
  updateSelection() {
    const selected = this.store.project.selected;
    for (const card of this.list.children) {
      card.classList.toggle('sel', card.dataset.track === selected);
    }
  }

  addTrack() {
    const p = this.store.project;
    if (p.tracks.length >= 10) {
      this.hooks.onMessage?.('Ten tracks is the limit — try layering with patterns instead.');
      return;
    }
    this.store.snapshot('add-track');
    const drumCount = p.tracks.filter((t) => t.type === 'drums').length;
    const type = drumCount === 0 ? 'drums' : 'melody';
    const used = new Set(p.tracks.map((t) => t.instrument));
    const inst = type === 'drums'
      ? (DRUM_KITS.find((k) => !used.has(k.id)) || DRUM_KITS[0]).id
      : (MELODY_INSTRUMENTS.find((m) => !used.has(m.id)) || MELODY_INSTRUMENTS[0]).id;
    const track = createTrack(type, {
      instrument: inst,
      name: type === 'drums' ? 'Drums' : (MELODY_INSTRUMENTS.find((m) => m.id === inst)?.name || 'Melody'),
      color: TRACK_COLORS[p.tracks.length % TRACK_COLORS.length],
    });
    p.tracks.push(track);
    p.selected = track.id;
    this.store.endGesture();
    this.hooks.onChange('layout');
  }

  render() {
    const p = this.store.project;
    const html = p.tracks.map((t) => {
      const options = (t.type === 'drums' ? DRUM_KITS : MELODY_INSTRUMENTS)
        .map((i) => `<option value="${i.id}"${i.id === t.instrument ? ' selected' : ''}>${esc(i.name)}</option>`)
        .join('');
      return `
      <div class="track${t.id === p.selected ? ' sel' : ''}${t.mute ? ' muted' : ''}" data-track="${t.id}" style="--tc:${t.color}">
        <div class="track-top">
          <input class="track-name" data-field="name" value="${esc(t.name)}" aria-label="Track name">
          <button class="tbtn" data-act="fold" title="${t.collapsed ? 'Show rows' : 'Fold this track'}">${t.collapsed ? '▸' : '▾'}</button>
          <button class="tbtn x" data-act="del" title="Delete track">✕</button>
        </div>
        <select class="track-inst" data-field="inst" aria-label="Instrument">${options}</select>
        <div class="track-btns">
          <button class="tbtn m${t.mute ? ' on' : ''}" data-act="mute" title="Mute">M</button>
          <button class="tbtn${t.solo ? ' on' : ''}" data-act="solo" title="Solo">S</button>
          <span class="track-vol"><input type="range" data-field="vol" min="0" max="1" step="0.01" value="${t.volume}" aria-label="Volume"></span>
        </div>
      </div>`;
    }).join('');
    this.list.innerHTML = html;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
