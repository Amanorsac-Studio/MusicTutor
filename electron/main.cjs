const { app, BrowserWindow, ipcMain, session, desktopCapturer, shell, utilityProcess } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { Streamer, ffmpegPath } = require('./streamer.cjs');
const { scanPlugins, launchPlugin } = require('./plugins.cjs');
const { StemSeparator, STEMS } = require('./stems.cjs');

/** The last scan, so a launch can only ever start something we found. */
let knownPlugins = [];

/** One encoder per output shape, created on demand. */
const streamers = {};

let mainWindow;

/** Stops the separation process on quit. Set once the app is ready. */
let stopStemWorker;

const projectsFolder = () => path.join(app.getPath('documents'), 'MusicTutor', 'Projects');
const recordingsFolder = () => path.join(app.getPath('videos'), 'MusicTutor');

/** Project files, under the current name and the one the app first shipped with. */
const PROJECT_EXTENSIONS = ['.musictutor.json', '.pianotutor.json'];
const isProjectFile = name => PROJECT_EXTENSIONS.some(extension => name.endsWith(extension));
const stripProjectExtension = name =>
  PROJECT_EXTENSIONS.reduce((result, extension) => result.replace(extension, ''), name);

/**
 * Carry everything over from when the app was called PianoTutor.
 *
 * The rename moves the settings folder and both library folders, and an update
 * that appeared to delete every saved lesson would be unforgivable. Each old
 * folder is copied across once, only when the new one does not exist yet, so a
 * later launch never overwrites newer work with older.
 */
function migrateFromPianoTutor() {
  const fsSync = require('fs');
  const moves = [
    [path.join(app.getPath('appData'), 'pianotutor-studio'), app.getPath('userData')],
    [path.join(app.getPath('documents'), 'PianoTutor'), path.join(app.getPath('documents'), 'MusicTutor')],
    [path.join(app.getPath('videos'), 'PianoTutor'), path.join(app.getPath('videos'), 'MusicTutor')],
  ];
  moves.forEach(([from, to]) => {
    try {
      if (!fsSync.existsSync(from) || fsSync.existsSync(to)) return;
      // Copied rather than renamed: a copy that fails halfway leaves the
      // original intact, where a failed rename can leave neither.
      fsSync.cpSync(from, to, { recursive: true });
    } catch { /* the old data stays where it was, which loses nothing */ }
  });
}

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
    title: 'MusicTutor',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Keep timers, audio and the recorder running at full rate when the
      // window is minimised — a lesson often keeps recording while hidden.
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      // For the YouTube browser in the Learn tab. Locked down below.
      webviewTag: true,
    },
  });

  const isDev = process.argv.includes('--dev');
  if (isDev) mainWindow.loadURL('http://127.0.0.1:5173');
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = undefined; });
}

// Before anything reads a setting, so the first launch under the new name
// finds the old data already in place.
migrateFromPianoTutor();

app.whenReady().then(() => {
  // Grant the capture permissions the studio needs. Everything else is denied.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'midi', 'midiSysex', 'audioCapture', 'videoCapture'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'midi', 'midiSysex', 'audioCapture', 'videoCapture'].includes(permission));

  /**
   * Screen and desktop-audio capture.
   *
   * Windows can hand back everything the speakers are playing as a loopback
   * stream, which is a far simpler answer than a virtual cable for getting a
   * plug-in's sound into the app: nothing to install and nothing to configure.
   * The video source is still required by the API even when only the audio is
   * wanted, so a screen is picked and its picture thrown away in the renderer.
   */
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      const source =
        sources.find(item => item.name === 'Entire screen') ||
        sources.find(item => item.id.startsWith('screen')) ||
        sources.find(item => item.name && item.name.includes('MusicTutor')) ||
        sources[0];
      if (!source) { callback({}); return; }
      // 'loopback' is what the system is playing. Without it the request would
      // capture a microphone, which is not what "desktop audio" means.
      callback(request.audioRequested ? { video: source, audio: 'loopback' } : { video: source });
    } catch {
      callback({});
    }
  }, { useSystemPicker: false });

  /**
   * The embedded browser.
   *
   * It shows somebody else's web pages inside the app, so it gets nothing of
   * the app's: no preload, no Node, its own storage, and no permissions at all.
   * It may only be pointed at YouTube and the Google pages YouTube sends people
   * through to sign in or accept cookies, and it cannot open windows.
   */
  const browsable = url => {
    try {
      const { protocol, hostname } = new URL(url);
      return protocol === 'https:' && /(^|\.)(youtube\.com|youtu\.be|google\.com|youtube-nocookie\.com)$/.test(hostname);
    } catch { return false; }
  };
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      params.partition = 'persist:learn-youtube';
      if (!browsable(params.src)) event.preventDefault();
    });
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(({ url }) => {
        // A link that wants a new window opens in place instead.
        if (browsable(url)) void contents.loadURL(url);
        return { action: 'deny' };
      });
      contents.on('will-navigate', (event, url) => { if (!browsable(url)) event.preventDefault(); });
    }
  });
  const tube = session.fromPartition('persist:learn-youtube');
  // Fullscreen is the one thing a video player reasonably asks for.
  tube.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
  tube.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');

  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => (mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()));
  ipcMain.on('window:close', () => mainWindow?.close());

  ipcMain.handle('recording:save', async (_event, bytes, suggestedName, extension) => {
    const folder = recordingsFolder();
    await fs.mkdir(folder, { recursive: true });
    const ext = /^(webm|mp4|mov|mkv)$/i.test(String(extension || '')) ? String(extension).toLowerCase() : 'webm';
    const filePath = path.join(folder, `${safeFileName(suggestedName, 'MusicTutor_Lesson')}_${timestamp()}.${ext}`);
    await fs.writeFile(filePath, Buffer.from(bytes));
    return filePath;
  });

  ipcMain.handle('midi:save', async (_event, bytes, suggestedName) => {
    const folder = recordingsFolder();
    await fs.mkdir(folder, { recursive: true });
    const filePath = path.join(folder, `${safeFileName(suggestedName, 'MusicTutor_Lesson')}_${timestamp()}.mid`);
    await fs.writeFile(filePath, Buffer.from(bytes));
    return filePath;
  });

  ipcMain.handle('project:save', async (_event, project) => {
    const folder = projectsFolder();
    await fs.mkdir(folder, { recursive: true });
    const filePath = path.join(folder, `${safeFileName(project && project.name, 'Untitled_Lesson')}.musictutor.json`);
    const payload = { ...(project || {}), version: 1, savedAt: new Date().toISOString() };
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    // A project saved under the old name is superseded by this one; leaving it
    // would list every updated project twice.
    const legacy = filePath.replace(/.musictutor.json$/, '.pianotutor.json');
    if (legacy !== filePath) await fs.unlink(legacy).catch(() => {});
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

    const target = path.join(projectsFolder(), `${safeFileName(name, 'Untitled_Lesson')}.musictutor.json`);
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
    const files = (await fs.readdir(folder)).filter(isProjectFile);
    const projects = await Promise.all(files.map(async name => {
      const filePath = path.join(folder, name);
      const stat = await fs.stat(filePath);
      let data = {};
      try { data = JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { /* keep the filename fallback */ }
      return {
        filePath,
        name: data.name || stripProjectExtension(name),
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

  ipcMain.handle('stream:available', async () => Boolean(ffmpegPath()));
  /**
   * A stream can run in two shapes at once — wide to one platform, tall to
   * another — so each output gets its own encoder rather than sharing one.
   */
  const streamerFor = output => {
    const key = output === 'secondary' ? 'secondary' : 'primary';
    if (!streamers[key]) {
      streamers[key] = new Streamer(path.join(app.getPath('userData'), `stream-${key}.log`));
      streamers[key].onStatus = status => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('stream:status', { ...status, output: key });
        }
      };
    }
    return streamers[key];
  };

  ipcMain.handle('stream:start', async (_event, targets, options) =>
    streamerFor(options && options.output).start(targets, options));
  ipcMain.handle('stream:stop', async (_event, output) => {
    if (output) return streamerFor(output).stop();
    // No output named means stop everything.
    return Object.values(streamers).reduce(
      (last, item) => (item ? item.stop() : last), { ok: true },
    );
  });
  ipcMain.handle('stream:status', async (_event, output) => streamerFor(output).status());
  // Chunks arrive frequently, so this is a one-way send rather than an invoke.
  ipcMain.on('stream:chunk', (_event, bytes, output) => { streamerFor(output).write(bytes); });

  /* ---------------------------------------------------------------- *
   * Stem separation
   * ---------------------------------------------------------------- */

  // Only ever used here to answer questions about files on disk. The network
  // itself is opened in the worker process, never in this one.
  const stemFiles = new StemSeparator(app.getPath('userData'));
  let stemWorker = null;
  let stemJob = 0;
  const stemJobs = new Map();

  const startStemWorker = () => {
    if (stemWorker) return stemWorker;
    const worker = utilityProcess.fork(path.join(__dirname, 'stemWorker.cjs'), [], { serviceName: 'MusicTutor stems' });
    worker.on('message', message => {
      if (message.type === 'progress') {
        mainWindow?.webContents.send('stems:progress', { stage: message.stage, fraction: message.fraction });
        return;
      }
      const waiting = stemJobs.get(message.job);
      if (!waiting) return;
      stemJobs.delete(message.job);
      if (message.type === 'done') waiting.resolve(message.result);
      else waiting.reject(new Error(message.message || 'Separation failed.'));
    });
    worker.on('exit', () => {
      if (stemWorker === worker) stemWorker = null;
      stemJobs.forEach(({ reject }) => reject(new Error('The separation engine stopped unexpectedly. Try again.')));
      stemJobs.clear();
    });
    worker.postMessage({ type: 'init', dataFolder: app.getPath('userData') });
    stemWorker = worker;
    return worker;
  };
  stopStemWorker = () => stemWorker?.kill();

  const askStemWorker = message => new Promise((resolve, reject) => {
    stemJob += 1;
    stemJobs.set(stemJob, { resolve, reject });
    startStemWorker().postMessage({ ...message, job: stemJob });
  });

  ipcMain.handle('stems:status', async () => ({ ...stemFiles.status(), busy: stemJobs.size > 0 }));
  ipcMain.handle('stems:download', async () => {
    await askStemWorker({ type: 'download' });
    return true;
  });
  ipcMain.handle('stems:separate', async (_event, left, right) => {
    if (!(left instanceof ArrayBuffer) || !(right instanceof ArrayBuffer) || left.byteLength !== right.byteLength) {
      throw new Error('Separation needs two channels of the same length.');
    }
    if (stemJobs.size) throw new Error('A song is already being separated.');
    const result = await askStemWorker({ type: 'separate', left, right });
    return { id: result.id, cached: result.cached, stems: STEMS };
  });
  ipcMain.handle('stems:cancel', async () => { stemWorker?.postMessage({ type: 'cancel' }); });
  // The renderer names a song by its fingerprint and a stem by name; the path
  // is built here, so it can never be pointed at anything else on the disk.
  ipcMain.handle('stems:read', async (_event, id, stem) => {
    if (!/^[0-9a-f]{20}$/.test(String(id)) || !STEMS.includes(stem)) throw new Error('No such stem.');
    const bytes = await fs.readFile(stemFiles.cacheFor(id).files[stem]);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  });

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

app.on('before-quit', () => {
  // A worker left running would hold the app open.
  try { stopStemWorker?.(); } catch { /* already gone */ }
  Object.values(streamers).forEach(item => { try { item.stop(); } catch { /* already gone */ } });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
