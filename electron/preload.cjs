/*
 * The only bridge between the page and Node: a Save-As helper for exports.
 * Context isolation stays on and nothing else is exposed.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  version: process.versions.electron,
  platform: process.platform,
  /**
   * @param {string} filename suggested name, e.g. "my-song.wav"
   * @param {ArrayBuffer} data file contents
   * @returns {Promise<{ok: boolean, path?: string, canceled?: boolean, error?: string}>}
   */
  saveFile: (filename, data) => ipcRenderer.invoke('save-file', filename, new Uint8Array(data)),
});
