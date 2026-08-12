/* Offline render of a whole song to an AudioBuffer, then to a .wav file. */

import { Rig, stepSeconds, swingOffset, resolveStep } from './engine.js';
import { totalSteps } from '../core/project.js';

/** Number of grid steps one full pass of the song takes. */
export function songSteps(project) {
  const total = totalSteps(project);
  return project.songMode && project.arrangement.length
    ? total * project.arrangement.length
    : total;
}

export async function renderProject(project, pitchList, { loops = 2, onProgress } = {}) {
  const stepDur = stepSeconds(project);
  const steps = songSteps(project) * Math.max(1, loops);
  const tail = 2.6 + project.fx.reverbSize * 2;
  const duration = steps * stepDur + tail;
  const rate = 44100;

  const OfflineCtx = self.OfflineAudioContext || self.webkitOfflineAudioContext;
  const ctx = new OfflineCtx(2, Math.ceil(rate * duration), rate);
  const rig = new Rig(ctx, project);
  rig.updateTempo(project.tempo, project.fx.delayTime);

  const soloed = project.tracks.some((t) => t.solo);
  const start = 0.05;

  for (let abs = 0; abs < steps; abs++) {
    const { patternIndex, local } = resolveStep(project, abs);
    const pattern = project.patterns[patternIndex];
    if (!pattern) continue;
    const time = start + abs * stepDur;
    for (const track of project.tracks) {
      if (soloed ? !track.solo : track.mute) continue;
      const notes = pattern.notes[track.id];
      if (!notes) continue;
      for (const note of notes) {
        if (note.s !== local) continue;
        rig.trigger(track, note, time + swingOffset(project, local, stepDur), pitchList, stepDur);
      }
    }
    if (onProgress && abs % 32 === 0) onProgress(0.05 + (abs / steps) * 0.35);
  }

  if (onProgress) onProgress(0.45);
  const buffer = await ctx.startRendering();
  if (onProgress) onProgress(1);
  return buffer;
}

/** 16-bit PCM WAV. */
export function encodeWav(buffer) {
  const chans = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = 44 + frames * chans * 2;
  const view = new DataView(new ArrayBuffer(bytes));

  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                       // PCM
  view.setUint16(22, chans, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * chans * 2, true);
  view.setUint16(32, chans * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, frames * chans * 2, true);

  const data = [];
  for (let c = 0; c < chans; c++) data.push(buffer.getChannelData(c));

  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < chans; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}
