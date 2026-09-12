/** Bridge exposed by electron/preload.cjs. Absent when running in a browser. */

export type ProjectSummary = {
  filePath: string;
  name: string;
  savedAt: string;
  scene: string;
};

export type RecordingSummary = {
  name: string;
  filePath: string;
  size: number;
  createdAt: string;
};

export type StreamStatusBridge = {
  state: 'idle' | 'starting' | 'live' | 'stopping' | 'error';
  destinations: string[];
  message?: string;
  uptime: number;
  bytesSent: number;
};

export type DesktopBridge = {
  isDesktop: boolean;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  saveRecording: (bytes: ArrayBuffer, name: string, extension?: string) => Promise<string>;
  saveMidi?: (bytes: ArrayBuffer, name: string) => Promise<string>;
  saveProject: (project: unknown) => Promise<string>;
  listProjects: () => Promise<ProjectSummary[]>;
  /** Read a saved project back. Restricted to the projects folder. */
  readProject?: (filePath: string) => Promise<Record<string, unknown>>;
  listRecordings: () => Promise<RecordingSummary[]>;
  openPath: (target: string) => Promise<string>;
  openLibraryFolder: (kind: 'projects' | 'recordings') => Promise<string>;
  loadSettings: () => Promise<Record<string, unknown>>;
  saveSettings: (value: unknown) => Promise<string>;
  /** Absolute paths of the library folders, for display in Settings. */
  paths?: () => Promise<{ projects: string; recordings: string }>;

  /* Live streaming. Chromium cannot speak RTMP, so a bundled ffmpeg in the
     main process does the transcoding and delivery. */
  /** Open an https link in the system browser. */
  openExternal?: (url: string) => Promise<string>;
  streamAvailable?: () => Promise<boolean>;
  streamStart?: (
    targets: Array<{ id: string; name: string; url: string }>,
    options: {
      width: number; height: number; frameRate: number;
      videoBitrate: number; audioBitrate: number;
    },
  ) => Promise<{ ok: boolean; message?: string; destinations?: string[] }>;
  streamStop?: () => Promise<{ ok: boolean }>;
  streamStatus?: () => Promise<StreamStatusBridge>;
  /** One chunk of recorded WebM, forwarded to ffmpeg's stdin. */
  streamChunk?: (bytes: ArrayBuffer) => void;
  onStreamStatus?: (handler: (status: StreamStatusBridge) => void) => () => void;
};

declare global {
  interface Window {
    pianoTutorDesktop?: DesktopBridge;
  }
}

export {};
