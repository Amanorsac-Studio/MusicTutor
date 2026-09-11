const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pianoTutorDesktop', {
  isDesktop: true,
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  saveRecording: (bytes, name, extension) => ipcRenderer.invoke('recording:save', bytes, name, extension),
  saveMidi: (bytes, name) => ipcRenderer.invoke('midi:save', bytes, name),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  listProjects: () => ipcRenderer.invoke('project:list'),
  readProject: (filePath) => ipcRenderer.invoke('project:read', filePath),
  listRecordings: () => ipcRenderer.invoke('recording:list'),
  openPath: (target) => ipcRenderer.invoke('path:open', target),
  openLibraryFolder: (kind) => ipcRenderer.invoke('library:open-folder', kind),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (value) => ipcRenderer.invoke('settings:save', value),
  paths: () => ipcRenderer.invoke('library:paths'),
  streamAvailable: () => ipcRenderer.invoke('stream:available'),
  streamStart: (targets, options) => ipcRenderer.invoke('stream:start', targets, options),
  streamStop: () => ipcRenderer.invoke('stream:stop'),
  streamStatus: () => ipcRenderer.invoke('stream:status'),
  streamChunk: (bytes) => ipcRenderer.send('stream:chunk', bytes),
  onStreamStatus: (handler) => {
    const listener = (_event, status) => handler(status);
    ipcRenderer.on('stream:status', listener);
    return () => ipcRenderer.removeListener('stream:status', listener);
  },
});
