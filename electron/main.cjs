/* Desktop shell for Music Lab Studio. */

const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const isMac = process.platform === 'darwin';
let mainWindow = null;

/**
 * Chromium will not fetch ES modules over file://, so the desktop build loads
 * the single-file bundle produced by `npm run standalone`. The multi-file
 * index.html is kept as a fallback for `npm run electron` during development.
 */
function entryFile() {
  const bundled = path.join(__dirname, '..', 'build', 'standalone.html');
  return fs.existsSync(bundled) ? bundled : path.join(__dirname, '..', 'index.html');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#0b0e17',
    title: 'Music Lab Studio',
    autoHideMenuBar: !isMac,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(entryFile());
  mainWindow.on('closed', () => { mainWindow = null; });

  // Keep navigation inside the app; send real links to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow(),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard shortcuts',
          click: () => mainWindow?.webContents.executeJavaScript(
            "document.querySelector('[data-panel=\"help\"]')?.click()"),
        },
        {
          label: 'About Music Lab Studio',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Music Lab Studio',
            message: `Music Lab Studio ${app.getVersion()}`,
            detail: 'Draw music on a grid. Everything runs on this computer — no account, no internet needed.',
            buttons: ['OK'],
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* Native Save-As for the export buttons. */
ipcMain.handle('save-file', async (_event, filename, data) => {
  const ext = path.extname(filename).replace('.', '') || 'bin';
  const filters = {
    wav: [{ name: 'WAV audio', extensions: ['wav'] }],
    mid: [{ name: 'MIDI file', extensions: ['mid'] }],
    json: [{ name: 'Project file', extensions: ['json'] }],
  }[ext] || [{ name: 'File', extensions: [ext] }];

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('music'), filename),
    filters,
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    await fs.promises.writeFile(filePath, Buffer.from(data));
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err && err.message) };
  }
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
