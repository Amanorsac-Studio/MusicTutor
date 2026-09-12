const { app, BrowserWindow, ipcMain, session, desktopCapturer, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { Streamer, ffmpegPath } = require('./streamer.cjs');
const { scanPlugins, launchPlugin } = require('./plugins.cjs');

/** The last scan, so a launch can only ever start something we found. */
let knownPlugins = [];

let streamer;

let mainWindow;

const projectsFolder = () => path.join(app.getPath('documents'), 'PianoTutor', 'Projects');
const recordingsFolder = () => path.join(app.getPath('videos'), 'PianoTutor');

/** Strip anything that could escape the target folder or upset Windows. */
const safeFileName = (value, fallback) => {
  const base = path.basename(String(value ?? '')).replace(/[^a-z0-9._-]/gi, '_').replace(/^\.+/, '');
  return base || fallback;
};

const timestamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/**
 * Resolve a path the renderer asked for, refusing anything outside the library.
 *
 * The renderer only ever sends paths this process handed it, but a path is
 * still untrusted input, and the answer to "read that file for me" must never
 * be able to reach the rest of the disk.
 */
function insideLibrary(target, folder) {
  const resolved = path.resolve(String(target ?? ''));
  const root = path.resolve(folder);
  const withSeparator = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(withSeparator)) {
    throw new Error('That file is outside the library folder.');
  }
  return resolved;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1536,
    height: 960,
    minWidth: 1180,
    minHeight: 720,
    frame: false,
    backgroundColor: '#07111b',
    title: 'PianoTutor',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Keep timers, audio and the recorder running at full rate when the
      // window is minimised — a lesson often keeps recording while hidden.
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = process.argv.includes('--dev');
  if (isDev) mainWindow.loadURL('http://127.0.0.1:5173');
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = undefined; });
}

app.whenReady().then(() => {
  streamer = new Streamer(path.join(app.getPath('userData'), 'stream.log'));
  // Grant the capture permissions the studio needs. Everything else is denied.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'midi', 'midiSysex', 'audioCapture', 'videoCapture'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'midi', 'midiSysex', 'audioCapture', 'videoCapture'].includes(permission));

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      const source =
        sources.find(item => item.name && item.name.includes('PianoTutor')) ||
        sources.find(item => item.name === 'Entire screen') ||
        sources.find(item => item.id.startsWith('screen')) ||
        sources[0];
      if (!source) { callback({}); return; }
      callback({ video: source });
    } catch {
      callback({});
    }
  });

  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => (mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()));
  ipcMain.on('window:close', () => mainWindow?.close());

  ipcMain.handle('recording:save', async (_event, bytes, suggestedName, extension) => {
    const folder = recordingsFolder();
    await fs.mkdir(folder, { recursive: true });
    const ext = /^(webm|mp4|mov|mkv)$/i.test(String(extension || '')) ? String(extension).toLowerCase() : 'webm';
    const filePath = path.join(folder, `${safeFileName(suggestedName, 'PianoTutor_Lesson')}_${timestamp()}.${ext}`);
    await fs.writeFile(filePath, Buffer.from(bytes));
    return filePath;
  });

  ipcMain.handle('midi:save', async (_event, bytes, suggestedName) => {
    const folder = recordingsFolder();
    await fs.mkdir(folder, { recursive: true });
    const filePath = path.join(folder, `${safeFileName(suggestedName, 'PianoTutor_Lesson')}_${timestamp()}.mid`);
    await fs.writeFile(filePath, Buffer.from(bytes));
    return filePath;
  });

  ipcMain.handle('project:save', async (_event, project) => {
    const folder = projectsFolder();
    await fs.mkdir(folder, { recursive: true });
    const filePath = path.join(folder, `${safeFileName(project && project.name, 'Untitled_Lesson')}.pianotutor.json`);
    const payload = { ...(project || {}), version: 1, savedAt: new Date().toISOString() };
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return filePath;
  });

  ipcMain.handle('project:read', async (_event, filePath) => {
    const resolved = insideLibrary(filePath, projectsFolder());
    const raw = await fs.readFile(resolved, 'utf8');
    return JSON.parse(raw);
  });

  ipcMain.handle('project:rename', async (_event, filePath, nextName) => {
    const resolved = insideLibrary(filePath, projectsFolder());
    const raw = JSON.parse(await fs.readFile(resolved, 'utf8'));
    const name = String(nextName ?? '').trim();
    if (!name) throw new Error('A project needs a name.');

    const target = path.join(projectsFolder(), `${safeFileName(name, 'Untitled_Lesson')}.pianotutor.json`);
    // The display name is what the user typed; the file name is the safe
    // version of it, so a project called "Grade 3 / scales" still saves.
    await fs.writeFile(resolved, JSON.stringify({ ...raw, name }, null, 2), 'utf8');
    if (target !== resolved) {
      const taken = await fs.access(target).then(() => true, () => false);
      if (taken) throw new Error('A project with that name already exists.');
      await fs.rename(resolved, target);
    }
    return target;
  });

  ipcMain.handle('project:delete', async (_event, filePath) => {
    const resolved = insideLibrary(filePath, projectsFolder());
    await fs.unlink(resolved);
    return resolved;
  });

  ipcMain.handle('recording:delete', async (_event, filePath) => {
    const resolved = insideLibrary(filePath, recordingsFolder());
    await fs.unlink(resolved);
    return resolved;
  });

  ipcMain.handle('project:list', async () => {
    const folder = projectsFolder();
    await fs.mkdir(folder, { recursive: true });
    const files = (await fs.readdir(folder)).filter(name => name.endsWith('.pianotutor.json'));
    const projects = await Promise.all(files.map(async name => {
      const filePath = path.join(folder, name);
      const stat = await fs.stat(filePath);
      let data = {};
      try { data = JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { /* keep the filename fallback */ }
      return {
        filePath,
        name: data.name || name.replace('.pianotutor.json', ''),
        savedAt: data.savedAt || stat.mtime.toISOString(),
        scene: data.scene || 'Default Lesson',
      };
    }));
    return projects.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  });

  ipcMain.handle('recording:list', async () => {
    const folder = recordingsFolder();
    await fs.mkdir(folder, { recursive: true });
    const files = (await fs.readdir(folder)).filter(name => /\.(webm|mp4|mov|mkv|mid)$/i.test(name));
    const items = await Promise.all(files.map(async name => {
      const filePath = path.join(folder, name);
      const stat = await fs.stat(filePath);
      return { name, filePath, size: stat.size, createdAt: stat.mtime.toISOString() };
    }));
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  ipcMain.handle('path:open', async (_event, target) => shell.openPath(String(target)));

  ipcMain.handle('library:open-folder', async (_event, kind) => {
    const folder = kind === 'recordings' ? recordingsFolder() : projectsFolder();
    await fs.mkdir(folder, { recursive: true });
    return shell.openPath(folder);
  });

  ipcMain.handle('library:paths', async () => ({ projects: projectsFolder(), recordings: recordingsFolder() }));

  // Only ever hand https links to the system browser.
  ipcMain.handle('external:open', async (_event, url) => {
    const target = String(url || '');
    if (!/^https:\/\//i.test(target)) throw new Error('Only https links can be opened');
    await shell.openExternal(target);
    return target;
  });

  ipcMain.handle('plugins:scan', async () => {
    knownPlugins = await scanPlugins();
    return knownPlugins;
  });

  ipcMain.handle('plugins:launch', async (_event, target) => launchPlugin(knownPlugins, target));

  /* ----------------------------------------------------------- streaming */

  streamer.onStatus = status => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stream:status', status);
  };

  ipcMain.handle('stream:available', async () => Boolean(ffmpegPath()));
  ipcMain.handle('stream:start', async (_event, targets, options) => streamer.start(targets, options));
  ipcMain.handle('stream:stop', async () => streamer.stop());
  ipcMain.handle('stream:status', async () => streamer.status());
  // Chunks arrive frequently, so this is a one-way send rather than an invoke.
  ipcMain.on('stream:chunk', (_event, bytes) => { streamer.write(bytes); });

  ipcMain.handle('settings:load', async () => {
    try {
      return JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
    } catch {
      return {};
    }
  });

  ipcMain.handle('settings:save', async (_event, value) => {
    const filePath = path.join(app.getPath('userData'), 'settings.json');
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
    return filePath;
  });

  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('before-quit', () => { streamer.stop(); });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
