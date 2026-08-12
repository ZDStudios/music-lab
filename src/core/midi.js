/* Standard MIDI File export, plus Web MIDI keyboard input. */

import { totalSteps, getKit, MELODY_INSTRUMENTS } from './project.js';
import { resolveStep } from '../audio/engine.js';

const TPQ = 480;   // ticks per quarter note

function vlq(n) {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

function str(s) {
  return Array.from(s, (c) => c.charCodeAt(0));
}

function chunk(id, data) {
  const len = data.length;
  return [...str(id), (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...data];
}

function meta(type, payload) {
  return [0xff, type, ...vlq(payload.length), ...payload];
}

/** How many grid steps a full pass of the song takes (mirrors the audio export). */
function passSteps(project) {
  const total = totalSteps(project);
  return project.songMode && project.arrangement.length ? total * project.arrangement.length : total;
}

export function exportMidi(project, pitchList, { loops = 1 } = {}) {
  const ticksPerStep = Math.max(1, Math.round(TPQ / project.splits));
  const steps = passSteps(project) * Math.max(1, loops);

  /* ---- conductor track ---- */
  const usPerQuarter = Math.round(60000000 / project.tempo);
  const tempoTrack = [
    0, ...meta(0x03, str(project.name || 'Music Lab Studio')),
    0, ...meta(0x51, [(usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255]),
    0, ...meta(0x58, [project.beatsPerBar, 2, 24, 8]),
    0, ...meta(0x2f, []),
  ];

  /* ---- one MIDI track per project track ---- */
  const trackChunks = [];
  let nextChannel = 0;

  for (const track of project.tracks) {
    const isDrums = track.type === 'drums';
    const channel = isDrums ? 9 : (nextChannel === 9 ? (nextChannel = 10, 10) : nextChannel);
    if (!isDrums) nextChannel = channel + 1;

    const kit = isDrums ? getKit(track.instrument) : null;
    const events = [];   // {tick, status, data1, data2, order}

    for (let abs = 0; abs < steps; abs++) {
      const { patternIndex, local } = resolveStep(project, abs);
      const pattern = project.patterns[patternIndex];
      const notes = pattern && pattern.notes[track.id];
      if (!notes) continue;
      const swingTicks = project.swing && project.splits % 2 === 0 && local % 2 === 1
        ? Math.round(project.swing * 0.5 * ticksPerStep) : 0;

      for (const note of notes) {
        if (note.s !== local) continue;
        let midiNote;
        if (isDrums) {
          midiNote = kit.pieces[note.p % kit.pieces.length].gm;
        } else {
          const pitch = pitchList[note.p];
          if (!pitch) continue;      // outside the current pitch ladder

          midiNote = pitch.midi + 12 * (track.octaveShift || 0);
        }
        if (midiNote < 0 || midiNote > 127) continue;
        const vel = Math.max(1, Math.min(127, Math.round((note.v ?? 0.85) * 110)));
        const onTick = abs * ticksPerStep + swingTicks;
        const lenTicks = isDrums
          ? Math.max(12, Math.round(ticksPerStep * 0.5))
          : Math.max(12, Math.round(Math.max(1, note.l || 1) * ticksPerStep * 0.94));
        events.push({ tick: onTick, status: 0x90 | channel, d1: midiNote, d2: vel, order: 1 });
        events.push({ tick: onTick + lenTicks, status: 0x80 | channel, d1: midiNote, d2: 0, order: 0 });
      }
    }

    events.sort((a, b) => a.tick - b.tick || a.order - b.order);

    const data = [0, ...meta(0x03, str(track.name || 'Track'))];
    if (!isDrums) {
      const inst = MELODY_INSTRUMENTS.find((m) => m.id === track.instrument);
      data.push(0, 0xc0 | channel, inst ? inst.gm : 0);
    }
    let last = 0;
    for (const e of events) {
      data.push(...vlq(Math.max(0, e.tick - last)), e.status, e.d1, e.d2);
      last = e.tick;
    }
    data.push(0, ...meta(0x2f, []));
    trackChunks.push(chunk('MTrk', data));
  }

  const header = chunk('MThd', [0, 1, (trackChunks.length + 1) >> 8, (trackChunks.length + 1) & 255, TPQ >> 8, TPQ & 255]);
  const bytes = [...header, ...chunk('MTrk', tempoTrack), ...trackChunks.flat()];
  return new Blob([new Uint8Array(bytes)], { type: 'audio/midi' });
}

/* ------------------------------------------------------------------ *
 * Web MIDI input
 * ------------------------------------------------------------------ */

export class MidiIn {
  constructor() {
    this.access = null;
    this.handler = null;
    this.deviceNames = [];
  }

  async init() {
    if (!navigator.requestMIDIAccess) return false;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      return false;
    }
    const attach = () => {
      this.deviceNames = [];
      for (const input of this.access.inputs.values()) {
        this.deviceNames.push(input.name);
        input.onmidimessage = (e) => this._onMessage(e);
      }
    };
    attach();
    this.access.onstatechange = attach;
    return true;
  }

  onNote(fn) {
    this.handler = fn;
  }

  _onMessage(e) {
    const [status, d1, d2] = e.data;
    const cmd = status & 0xf0;
    if (!this.handler) return;
    if (cmd === 0x90 && d2 > 0) this.handler(d1, d2 / 127, true);
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) this.handler(d1, 0, false);
  }
}
