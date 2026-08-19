/*
 * The audio graph ("Rig") and the step scheduler ("Transport").
 *
 * Rig is deliberately context-agnostic: the same code builds the live graph on
 * an AudioContext and the export graph on an OfflineAudioContext.
 */

import { playMelody, playDrum, playClick } from './instruments.js';
import { midiToFreq } from '../core/scales.js';
import { totalSteps, getKit } from '../core/project.js';

const LOOKAHEAD = 0.12;   // seconds of notes scheduled in advance
const TICK_MS = 25;

/* ------------------------------------------------------------------ *
 * Reverb impulse
 * ------------------------------------------------------------------ */

function makeImpulse(ctx, size) {
  const seconds = 0.45 + size * 2.6;
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const decay = 2.2 + size * 3.5;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
    // A couple of early reflections stop it sounding like plain noise.
    const r1 = Math.floor(ctx.sampleRate * (0.012 + ch * 0.004));
    const r2 = Math.floor(ctx.sampleRate * (0.031 + ch * 0.006));
    if (r1 < len) d[r1] += 0.5;
    if (r2 < len) d[r2] += 0.32;
  }
  return buf;
}

function driveCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = 1 + amount * 24;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

/* ------------------------------------------------------------------ *
 * Rig
 * ------------------------------------------------------------------ */

export class Rig {
  constructor(ctx, project) {
    this.ctx = ctx;
    this.live = typeof ctx.resume === 'function' && !ctx.length;
    this.channels = new Map();
    this._reverbSize = -1;

    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };

    this.bus = g(1);
    this.sum = g(1);
    this.dry = g(1);
    this.revSend = g(0);
    this.dlySend = g(0);

    this.convolver = ctx.createConvolver();
    this.delay = ctx.createDelay(2.5);
    this.delayFb = g(0.35);
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.value = 3200;

    this.drive = ctx.createWaveShaper();
    this.drive.curve = driveCurve(0);
    this.driveComp = g(1);

    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 18000;

    this.chorusMix = g(0);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -13;
    this.comp.knee.value = 14;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.19;
    this.master = g(0.85);

    // bus → dry / sends
    this.bus.connect(this.dry).connect(this.sum);
    this.bus.connect(this.revSend).connect(this.convolver).connect(this.sum);
    this.bus.connect(this.dlySend).connect(this.delay);
    this.delay.connect(this.delayTone).connect(this.delayFb).connect(this.delay);
    this.delayTone.connect(this.sum);

    // sum → colour → out
    this.sum.connect(this.drive).connect(this.driveComp).connect(this.tone);
    this.tone.connect(this.comp);

    // chorus: two modulated taps in parallel with the dry tone signal
    this.chorusVoices = [];
    for (let i = 0; i < 2; i++) {
      const d = ctx.createDelay(0.06);
      d.delayTime.value = 0.011 + i * 0.008;
      const lfoOsc = ctx.createOscillator();
      lfoOsc.frequency.value = 0.24 + i * 0.19;
      const depth = g(0.0035 + i * 0.0012);
      lfoOsc.connect(depth).connect(d.delayTime);
      lfoOsc.start(0);
      this.tone.connect(d).connect(this.chorusMix);
      this.chorusVoices.push({ d, lfoOsc });
    }
    this.chorusMix.connect(this.comp);
    this.comp.connect(this.master).connect(ctx.destination);

    this.updateFx(project.fx);
    this.syncTracks(project);
  }

  _set(param, value, smooth = 0.03) {
    if (this.live) param.setTargetAtTime(value, this.ctx.currentTime, smooth);
    else param.setValueAtTime(value, 0);
  }

  updateFx(fx) {
    const size = Math.max(0.05, Math.min(1, fx.reverbSize ?? 0.6));
    if (Math.abs(size - this._reverbSize) > 0.02) {
      this._reverbSize = size;
      this.convolver.buffer = makeImpulse(this.ctx, size);
    }
    this._set(this.revSend.gain, (fx.reverb ?? 0) * 0.95);
    this._set(this.dry.gain, 1 - (fx.reverb ?? 0) * 0.2);
    this._set(this.dlySend.gain, (fx.delay ?? 0) * 0.8);
    this._set(this.delayFb.gain, 0.2 + (fx.delay ?? 0) * 0.4);
    this._set(this.tone.frequency, 320 * Math.pow(2, Math.max(0, Math.min(1, fx.tone ?? 1)) * 5.9));
    this._set(this.chorusMix.gain, (fx.chorus ?? 0) * 0.5);
    this._set(this.master.gain, Math.max(0, Math.min(1, fx.master ?? 0.85)));
    const dr = Math.max(0, Math.min(1, fx.drive ?? 0));
    this.drive.curve = driveCurve(dr);
    this._set(this.driveComp.gain, 1 / (1 + dr * 1.1));
  }

  /** Delay time follows the song tempo. */
  updateTempo(tempo, delayTimeBeats) {
    const secs = Math.max(0.02, Math.min(2.4, (60 / tempo) * (delayTimeBeats || 0.5)));
    this._set(this.delay.delayTime, secs, 0.05);
  }

  syncTracks(project) {
    const soloed = project.tracks.some((t) => t.solo);
    const seen = new Set();
    for (const track of project.tracks) {
      seen.add(track.id);
      let ch = this.channels.get(track.id);
      if (!ch) {
        const gain = this.ctx.createGain();
        const pan = this.ctx.createStereoPanner();
        gain.connect(pan).connect(this.bus);
        ch = { gain, pan };
        this.channels.set(track.id, ch);
      }
      const audible = soloed ? track.solo : !track.mute;
      this._set(ch.gain.gain, audible ? track.volume : 0, 0.02);
      this._set(ch.pan.pan, Math.max(-1, Math.min(1, track.pan || 0)), 0.02);
    }
    for (const [id, ch] of this.channels) {
      if (!seen.has(id)) {
        ch.gain.disconnect();
        ch.pan.disconnect();
        this.channels.delete(id);
      }
    }
  }

  channelFor(trackId) {
    const ch = this.channels.get(trackId);
    return ch ? ch.gain : this.bus;
  }

  /** Play one note of one track at an absolute context time. */
  trigger(track, note, time, pitchList, stepDur) {
    const out = this.channelFor(track.id);
    const vel = Math.max(0.05, Math.min(1.2, note.v ?? 0.85));
    if (track.type === 'drums') {
      const kit = getKit(track.instrument);
      playDrum(this.ctx, out, kit.id, note.p % kit.pieces.length, time, vel);
    } else {
      // A note can sit outside the ladder after the scale or octave range
      // shrinks. Stay silent rather than snapping it to a wrong pitch — it
      // comes back if the range is widened again.
      const pitch = pitchList[note.p];
      if (!pitch) return;
      const freq = midiToFreq(pitch.midi + 12 * (track.octaveShift || 0));
      const dur = Math.max(0.06, Math.max(1, note.l || 1) * stepDur * 0.94);
      playMelody(this.ctx, out, track.instrument, freq, time, dur, vel);
    }
  }

  click(time, strong) {
    playClick(this.ctx, this.master, time, strong);
  }

  dispose() {
    try {
      this.chorusVoices.forEach((v) => v.lfoOsc.stop());
      this.master.disconnect();
    } catch { /* already gone */ }
  }
}

/* ------------------------------------------------------------------ *
 * Timing helpers shared by playback and export
 * ------------------------------------------------------------------ */

export function stepSeconds(project) {
  return 60 / project.tempo / project.splits;
}

/** Push every other subdivision later to create a shuffle feel. */
export function swingOffset(project, localStep, stepDur) {
  if (!project.swing || project.splits % 2 !== 0) return 0;
  return localStep % 2 === 1 ? project.swing * 0.5 * stepDur : 0;
}

/** Which pattern (and where inside it) an absolute step lands on. */
export function resolveStep(project, absStep) {
  const total = totalSteps(project);
  const local = ((absStep % total) + total) % total;
  if (project.songMode && project.arrangement.length) {
    const loop = Math.floor(absStep / total) % project.arrangement.length;
    return { patternIndex: project.arrangement[loop], local, chainIndex: loop };
  }
  return { patternIndex: project.patternIndex, local, chainIndex: -1 };
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

export class Transport {
  constructor({ ctx, rig, getProject, getPitchList, onStepScheduled }) {
    this.ctx = ctx;
    this.rig = rig;
    this.getProject = getProject;
    this.getPitchList = getPitchList;
    this.onStepScheduled = onStepScheduled;
    this.playing = false;
    this.metronome = false;
    this.absStep = 0;
    this.nextTime = 0;
    this.timeline = [];
    this._timer = null;
  }

  start(fromStep = null) {
    if (this.playing) return;
    if (fromStep != null) this.absStep = fromStep;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.timeline = [];
    this._timer = setInterval(() => this._tick(), TICK_MS);
    this._tick();
  }

  stop() {
    this.playing = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.timeline = [];
  }

  rewind() {
    this.seek(0);
  }

  /** Jump the playhead. Playing carries on from the new spot. */
  seek(absStep) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.stop();
    this.absStep = Math.max(0, Math.round(absStep));
    if (wasPlaying) this.start();
  }

  /** Seek within the pattern that is on screen, keeping the place in the song. */
  seekLocal(localStep) {
    const total = totalSteps(this.getProject());
    const cycle = Math.floor(this.absStep / total);
    this.seek(cycle * total + Math.max(0, Math.min(total - 1, localStep)));
  }

  /**
   * Where the playhead is, playing or not. Paused positions keep showing so
   * you can see — and drag — the spot playback will resume from.
   */
  current() {
    if (this.playing) {
      const live = this.position();
      if (live) return live;
    }
    const { patternIndex, local, chainIndex } = resolveStep(this.getProject(), this.absStep);
    return { absStep: this.absStep, time: 0, patternIndex, local, chainIndex, frac: 0, paused: true };
  }

  _tick() {
    if (!this.playing) return;
    const p = this.getProject();
    const guard = 400;
    let n = 0;
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD && n++ < guard) {
      const stepDur = stepSeconds(p);
      this._scheduleStep(p, this.absStep, this.nextTime, stepDur);
      this.absStep += 1;
      this.nextTime += stepDur;
    }
    // Keep only recent entries so position lookup stays cheap.
    const cutoff = this.ctx.currentTime - 0.5;
    while (this.timeline.length > 2 && this.timeline[1].time < cutoff) this.timeline.shift();
  }

  _scheduleStep(p, absStep, time, stepDur) {
    const { patternIndex, local, chainIndex } = resolveStep(p, absStep);
    const pattern = p.patterns[patternIndex];
    this.timeline.push({ absStep, time, patternIndex, local, chainIndex });

    if (this.metronome && local % p.splits === 0) {
      this.rig.click(time, local === 0);
    }

    const soloed = p.tracks.some((t) => t.solo);
    const pitchList = this.getPitchList();
    const humanize = p.humanize || 0;

    for (const track of p.tracks) {
      if (soloed ? !track.solo : track.mute) continue;
      const notes = pattern && pattern.notes[track.id];
      if (!notes || !notes.length) continue;
      for (const note of notes) {
        if (note.s !== local) continue;
        let t = time + swingOffset(p, local, stepDur);
        if (humanize) {
          t += (Math.random() - 0.5) * humanize * stepDur * 0.35;
          const jitter = 1 - humanize * 0.3 * Math.random();
          this.rig.trigger(track, { ...note, v: (note.v ?? 0.85) * jitter }, Math.max(time, t), pitchList, stepDur);
        } else {
          this.rig.trigger(track, note, t, pitchList, stepDur);
        }
      }
    }
    if (this.onStepScheduled) this.onStepScheduled(absStep, time, patternIndex);
  }

  /** Where the playhead is right now, interpolated for a smooth line. */
  position() {
    if (!this.playing || !this.timeline.length) return null;
    const now = this.ctx.currentTime;
    let entry = this.timeline[0];
    for (let i = this.timeline.length - 1; i >= 0; i--) {
      if (this.timeline[i].time <= now) { entry = this.timeline[i]; break; }
    }
    const p = this.getProject();
    const stepDur = stepSeconds(p);
    const frac = Math.max(0, Math.min(1, (now - entry.time) / stepDur));
    return { ...entry, frac };
  }

  /** The step a live/recorded note should snap to. */
  recordStep() {
    const pos = this.position();
    if (!pos) return null;
    const rounded = pos.frac > 0.5 ? pos.local + 1 : pos.local;
    const p = this.getProject();
    return { patternIndex: pos.patternIndex, step: rounded % totalSteps(p) };
  }
}
