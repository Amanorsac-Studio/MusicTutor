const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pianoTutorDesktop', {
  isDesktop: true,
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  saveRecording: (bytes, name, extension) => ipcRenderer.invoke('recording:save', bytes, name, extension),
  saveMidi: (bytes, name, pairedVideo) => ipcRenderer.invoke('midi:save', bytes, name, pairedVideo),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  listProjects: () => ipcRenderer.invoke('project:list'),
  readProject: (filePath) => ipcRenderer.invoke('project:read', filePath),
  renameProject: (filePath, name) => ipcRenderer.invoke('project:rename', filePath, name),
  deleteProject: (filePath) => ipcRenderer.invoke('project:delete', filePath),
  deleteRecording: (filePath) => ipcRenderer.invoke('recording:delete', filePath),
  listRecordings: () => ipcRenderer.invoke('recording:list'),
  openPath: (target) => ipcRenderer.invoke('path:open', target),
  openLibraryFolder: (kind) => ipcRenderer.invoke('library:open-folder', kind),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (value) => ipcRenderer.invoke('settings:save', value),
  paths: () => ipcRenderer.invoke('library:paths'),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  scanPlugins: () => ipcRenderer.invoke('plugins:scan'),
  launchPlugin: (target) => ipcRenderer.invoke('plugins:launch', target),
  stemStatus: () => ipcRenderer.invoke('stems:status'),
  stemDownload: () => ipcRenderer.invoke('stems:download'),
  stemSeparate: (left, right) => ipcRenderer.invoke('stems:separate', left, right),
  stemCancel: () => ipcRenderer.invoke('stems:cancel'),
  stemRead: (id, stem) => ipcRenderer.invoke('stems:read', id, stem),
  onStemProgress: (handler) => {
    const listener = (_event, progress) => handler(progress);
    ipcRenderer.on('stems:progress', listener);
    return () => ipcRenderer.removeListener('stems:progress', listener);
  },
  shareLesson: (videoPath) => ipcRenderer.invoke('lesson:share', videoPath),
  readLesson: (filePath) => ipcRenderer.invoke('lesson:read', filePath),
  readRecordingLesson: (videoPath) => ipcRenderer.invoke('lesson:read-recording', videoPath),
  takePendingLesson: () => ipcRenderer.invoke('lesson:pending'),
  onOpenLesson: (handler) => {
    const listener = (_event, filePath) => handler(filePath);
    ipcRenderer.on('lesson:open', listener);
    return () => ipcRenderer.removeListener('lesson:open', listener);
  },
  saveLearnSong: (entry) => ipcRenderer.invoke('learn:save', entry),
  listLearnSongs: () => ipcRenderer.invoke('learn:list'),
  deleteLearnSong: (id) => ipcRenderer.invoke('learn:delete', id),
  streamAvailable: () => ipcRenderer.invoke('stream:available'),
  streamStart: (targets, options) => ipcRenderer.invoke('stream:start', targets, options),
  // `output` names which shape's encoder to act on: 'primary' or 'secondary'.
  streamStop: (output) => ipcRenderer.invoke('stream:stop', output),
  streamStatus: (output) => ipcRenderer.invoke('stream:status', output),
  streamChunk: (bytes, output) => ipcRenderer.send('stream:chunk', bytes, output),
  onStreamStatus: (handler) => {
    const listener = (_event, status) => handler(status);
    ipcRenderer.on('stream:status', listener);
    return () => ipcRenderer.removeListener('stream:status', listener);
  },
});
