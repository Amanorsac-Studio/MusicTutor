const { app, BrowserWindow, ipcMain, session, desktopCapturer, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');

let mainWindow;

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
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = process.argv.includes('--dev');
  if (isDev) mainWindow.loadURL('http://127.0.0.1:5173');
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'midi', 'midiSysex'].includes(permission));
  });
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    const source = sources.find(item => item.name.includes('PianoTutor')) || sources.find(item => item.name === 'Entire screen') || sources[0];
    callback({ video: source });
  });
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('recording:save', async (_event, bytes, suggestedName) => {
    const folder = path.join(app.getPath('videos'), 'PianoTutor');
    await fs.mkdir(folder, { recursive: true });
    const safeName = String(suggestedName || 'PianoTutor_Lesson').replace(/[^a-z0-9._-]/gi, '_');
    const filePath = path.join(folder, `${safeName}_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`);
    await fs.writeFile(filePath, Buffer.from(bytes));
    return filePath;
  });
  ipcMain.handle('project:save', async (_event, project) => {
    const folder = path.join(app.getPath('documents'), 'PianoTutor', 'Projects');
    await fs.mkdir(folder, { recursive: true });
    const safeName = String(project?.name || 'Untitled Lesson').replace(/[^a-z0-9._-]/gi, '_');
    const filePath = path.join(folder, `${safeName}.pianotutor.json`);
    await fs.writeFile(filePath, JSON.stringify({ ...project, version: 1, savedAt: new Date().toISOString() }, null, 2), 'utf8');
    return filePath;
  });
  ipcMain.handle('project:list', async () => {
    const folder = path.join(app.getPath('documents'), 'PianoTutor', 'Projects');
    await fs.mkdir(folder, { recursive: true });
    const files = (await fs.readdir(folder)).filter(name => name.endsWith('.pianotutor.json'));
    const projects = await Promise.all(files.map(async name => {
      const filePath=path.join(folder,name); const stat=await fs.stat(filePath); let data={};
      try{data=JSON.parse(await fs.readFile(filePath,'utf8'))}catch{}
      return {filePath,name:data.name||name.replace('.pianotutor.json',''),savedAt:data.savedAt||stat.mtime.toISOString(),scene:data.scene||'Default Lesson'};
    }));
    return projects.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
  });
  ipcMain.handle('recording:list', async () => {
    const folder=path.join(app.getPath('videos'),'PianoTutor');await fs.mkdir(folder,{recursive:true});
    const files=(await fs.readdir(folder)).filter(name=>/\.(webm|mp4|mov)$/i.test(name));
    return Promise.all(files.map(async name=>{const filePath=path.join(folder,name);const stat=await fs.stat(filePath);return {name,filePath,size:stat.size,createdAt:stat.mtime.toISOString()}}));
  });
  ipcMain.handle('path:open', async (_event,target) => shell.openPath(String(target)));
  ipcMain.handle('library:open-folder', async (_event,kind) => {
    const folder=kind==='recordings'?path.join(app.getPath('videos'),'PianoTutor'):path.join(app.getPath('documents'),'PianoTutor','Projects');
    await fs.mkdir(folder,{recursive:true}); return shell.openPath(folder);
  });
  ipcMain.handle('settings:load', async () => {try{return JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'settings.json'),'utf8'))}catch{return {}}});
  ipcMain.handle('settings:save', async (_event,value) => {const filePath=path.join(app.getPath('userData'),'settings.json');await fs.writeFile(filePath,JSON.stringify(value,null,2),'utf8');return filePath});
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
