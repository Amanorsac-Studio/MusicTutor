const { app, BrowserWindow, ipcMain, session, desktopCapturer, shell, utilityProcess, dialog } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { Streamer, ffmpegPath } = require('./streamer.cjs');
const { scanPlugins, launchPlugin } = require('./plugins.cjs');
const { StemSeparator, STEMS } = require('./stems.cjs');
const { writeLesson, EXTENSION: LESSON_EXTENSION } = require('./lessonBundle.cjs');

/** The last scan, so a launch can only ever start something we found. */
let knownPlugins = [];

/** One encoder per output shape, created on demand. */
const streamers = {};

let mainWindow;

/** Stops the separation process on quit. Set once the app is ready. */
let stopStemWorker;

/**
 * Where the app keeps things, as the studio's File & Data Conventions fix it.
 * Two places and nothing anywhere else: what the person made, in their
 * Documents, and the machine's own state, out of their way.
 */
const PRODUCT = 'MusicTutor';
const contentFolder = () => path.join(app.getPath('documents'), 'Amanorsac Studio', PRODUCT);
const stateFolder = () => (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'), 'Amanorsac Studio', PRODUCT)
  : path.join(app.getPath('appData'), 'Amanorsac Studio', PRODUCT));

// Where Electron would have put it, read before it is changed, so data from
// earlier builds can be found and carried over.
const legacyStateFolder = app.getPath('userData');
// A test run names its own folder on the command line; leave that alone.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', stateFolder());

const projectsFolder = () => path.join(contentFolder(), 'Projects');
const recordingsFolder = () => path.join(contentFolder(), 'Recordings');

/** Project files, under the current name and the one the app first shipped with. */
const PROJECT_EXTENSIONS = ['.musictutor.json', '.pianotutor.json'];
const isProjectFile = name => PROJECT_EXTENSIONS.some(extension => name.endsWith(extension));
const stripProjectExtension = name =>
  PROJECT_EXTENSIONS.reduce((result, extension) => result.replace(extension, ''), name);

/**
 * Carry everything over from where earlier builds kept it.
 *
 * The app has been called PianoTutor, and then kept its data in folders of its
 * own naming before the studio's conventions were applied. An update that
 * appeared to delete every saved lesson would be unforgivable, so each old
 * place is copied across once, only into a place that does not exist yet, and
 * the first old place that exists wins. Copied, not moved: a copy that fails
 * half way leaves the original whole.
 */
function migrateEarlierData() {
  const fsSync = require('fs');
  const documents = app.getPath('documents');
  const videos = app.getPath('videos');
  const copyFirst = (candidates, target) => {
    try {
      if (fsSync.existsSync(target)) return;
      const source = candidates.find(candidate => fsSync.existsSync(candidate));
      if (!source) return;
      fsSync.mkdirSync(path.dirname(target), { recursive: true });
      fsSync.cpSync(source, target, { recursive: true });
    } catch { /* the old data stays where it was, which loses nothing */ }
  };

  copyFirst([path.join(documents, 'MusicTutor', 'Projects'), path.join(documents, 'PianoTutor', 'Projects')], projectsFolder());
  copyFirst([path.join(videos, 'MusicTutor'), path.join(videos, 'PianoTutor')], recordingsFolder());

  // Machine state: only what is worth keeping. The rest of the old folder is
  // the browser engine's caches, which rebuild themselves.
  const oldStates = [legacyStateFolder, path.join(app.getPath('appData'), 'pianotutor-studio')]
    .filter(folder => path.resolve(folder) !== path.resolve(app.getPath('userData')));
  ['settings.json', 'models', 'stems', 'learn-library', 'Local Storage'].forEach(name => {
    copyFirst(oldStates.map(folder => path.join(folder, name)), path.join(app.getPath('userData'), name));
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

/** A lesson file named on the command line, if the app was started by opening one. */
const lessonFromArguments = args => args.find(arg => String(arg).toLowerCase().endsWith(LESSON_EXTENSION)) || null;

/** Waits here until the window is up and asks for it. */
let pendingLesson = lessonFromArguments(process.argv);

/**
 * The MIDI that was played during a recording.
 *
 * New recordings save their MIDI under the video's own name. Older ones were
 * saved with a timestamp a moment apart, so those are matched by name and by
 * having been written within seconds of the video.
 */
async function findMidiFor(videoPath) {
  const exact = videoPath.replace(/\.[^./\\]+$/, '.mid');
  if (await fs.access(exact).then(() => true, () => false)) return exact;
  const folder = path.dirname(videoPath);
  const stamp = /_\d{4}-\d{2}-\d{2}T.*$/;
  const stem = path.basename(videoPath).replace(/\.[^.]+$/, '').replace(stamp, '');
  const videoTime = (await fs.stat(videoPath)).mtimeMs;
  let best = null;
  for (const name of await fs.readdir(folder)) {
    if (!/\.mid$/i.test(name) || name.replace(/\.mid$/i, '').replace(stamp, '') !== stem) continue;
    const gap = Math.abs((await fs.stat(path.join(folder, name))).mtimeMs - videoTime);
    if (gap <= 15000 && (!best || gap < best.gap)) best = { name, gap };
  }
  return best ? path.join(folder, best.name) : null;
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
migrateEarlierData();

// Opening a lesson file while the app is already running would otherwise start
// a second copy. Hand it to the first one instead.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const lesson = lessonFromArguments(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (lesson) mainWindow.webContents.send('lesson:open', lesson);
    } else if (lesson) {
      pendingLesson = lesson;
    }
  });
}

app.whenReady().then(() => {
  // The copy that was turned away has nothing to start.
  if (!gotLock) return;

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

  ipcMain.handle('midi:save', async (_event, bytes, suggestedName, pairedVideo) => {
    const folder = recordingsFolder();
    await fs.mkdir(folder, { recursive: true });
    // Saved under the video's own name when there is one, so the two can always
    // be found together again.
    const filePath = pairedVideo
      ? insideLibrary(pairedVideo, folder).replace(/\.[^./\\]+$/, '.mid')
      : path.join(folder, `${safeFileName(suggestedName, 'MusicTutor_Lesson')}_${timestamp()}.mid`);
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

  /* ---------------------------------------------------------------- *
   * Shared lessons
   * ---------------------------------------------------------------- */

  const lessonName = videoPath =>
    path.basename(videoPath).replace(/\.[^.]+$/, '').replace(/_\d{4}-\d{2}-\d{2}T.*$/, '').replace(/_/g, ' ').trim() || 'Lesson';

  // Pack a recording and its MIDI into one file to send. The person chooses
  // where it goes; nothing is written anywhere they did not pick.
  ipcMain.handle('lesson:share', async (_event, videoPath) => {
    const video = insideLibrary(videoPath, recordingsFolder());
    const midi = await findMidiFor(video);
    const name = lessonName(video);
    const chosen = await dialog.showSaveDialog(mainWindow, {
      title: 'Share this lesson',
      defaultPath: path.join(app.getPath('documents'), `${safeFileName(name, 'Lesson')}${LESSON_EXTENSION}`),
      filters: [{ name: 'MusicTutor lesson', extensions: [LESSON_EXTENSION.slice(1)] }],
    });
    if (chosen.canceled || !chosen.filePath) return null;
    const target = chosen.filePath.toLowerCase().endsWith(LESSON_EXTENSION) ? chosen.filePath : chosen.filePath + LESSON_EXTENSION;
    await writeLesson(target, { name, videoPath: video, midiPath: midi });
    shell.showItemInFolder(target);
    return { path: target, withMidi: Boolean(midi) };
  });

  // A lesson file somebody sent, opened through the operating system. Only
  // lesson files can be read this way, whatever path is asked for.
  ipcMain.handle('lesson:read', async (_event, filePath) => {
    const resolved = path.resolve(String(filePath ?? ''));
    if (!resolved.toLowerCase().endsWith(LESSON_EXTENSION)) throw new Error('That is not a lesson file.');
    const bytes = await fs.readFile(resolved);
    return { name: path.basename(resolved), bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  });

  // The teacher's own recording, to try it in the Learn tab as a student would.
  ipcMain.handle('lesson:read-recording', async (_event, videoPath) => {
    const video = insideLibrary(videoPath, recordingsFolder());
    const midi = await findMidiFor(video);
    const [videoBytes, midiBytes] = await Promise.all([fs.readFile(video), midi ? fs.readFile(midi) : null]);
    const slice = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return {
      name: lessonName(video),
      type: /\.mp4$/i.test(video) ? 'video/mp4' : 'video/webm',
      video: slice(videoBytes),
      midi: midiBytes ? slice(midiBytes) : null,
    };
  });

  // Asked once by the window when it starts, for a lesson it was opened with.
  ipcMain.handle('lesson:pending', async () => {
    const path_ = pendingLesson;
    pendingLesson = null;
    return path_;
  });

  /* ---------------------------------------------------------------- *
   * The Learn library
   *
   * Once a song's stems are on disk, everything needed to reopen it — the
   * mix, rebuilt by summing the stems — is already there. Only the small
   * facts around it need saving: its name, its chords, its key, the notes
   * already heard. So a "song" here is a stem fingerprint plus a JSON file
   * of those facts, never a second copy of the audio.
   * ---------------------------------------------------------------- */

  const learnLibraryFolder = () => path.join(app.getPath('userData'), 'learn-library');

  ipcMain.handle('learn:save', async (_event, entry) => {
    const id = String(entry && entry.id || '');
    if (!/^[0-9a-f]{20}$/.test(id)) throw new Error('A song can only be saved once its stems are ready.');
    const folder = learnLibraryFolder();
    await fs.mkdir(folder, { recursive: true });
    const filePath = path.join(folder, `${id}.json`);
    const payload = { ...entry, savedAt: new Date().toISOString() };
    await fs.writeFile(filePath, JSON.stringify(payload), 'utf8');
    return id;
  });

  ipcMain.handle('learn:list', async () => {
    const folder = learnLibraryFolder();
    await fs.mkdir(folder, { recursive: true });
    const files = (await fs.readdir(folder)).filter(name => name.endsWith('.json'));
    const entries = await Promise.all(files.map(async name => {
      try { return JSON.parse(await fs.readFile(path.join(folder, name), 'utf8')); } catch { return null; }
    }));
    return entries.filter(Boolean).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  });

  ipcMain.handle('learn:delete', async (_event, id) => {
    if (!/^[0-9a-f]{20}$/.test(String(id))) throw new Error('No such song.');
    await fs.unlink(path.join(learnLibraryFolder(), `${id}.json`)).catch(() => {});
    return id;
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
    let next = value;
    // Settings and scenes share this file. A save that carries only settings
    // — one preference changed — must not throw the scenes away, which is
    // what happened when it landed after the save that carried both.
    if (next && typeof next === 'object' && !('scenes' in next)) {
      try {
        const existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if (Array.isArray(existing.scenes)) {
          next = { ...next, scenes: existing.scenes, activeSceneId: existing.activeSceneId };
        }
      } catch { /* nothing saved yet, or unreadable: nothing to keep */ }
    }
    // Written aside and renamed into place, so being closed mid-write can never
    // leave half a file where the whole one was.
    const partial = `${filePath}.part`;
    await fs.writeFile(partial, JSON.stringify(next, null, 2), 'utf8');
    await fs.rename(partial, filePath);
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
