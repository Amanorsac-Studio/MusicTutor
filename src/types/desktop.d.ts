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

export type StemName = 'drums' | 'bass' | 'other' | 'vocals' | 'guitar' | 'piano';

/** Where a test build stands. An ordinary build is always open. */
export type BetaStatus = {
  testBuild: boolean;
  state: 'open' | 'locked' | 'expired';
  expiresAt?: string;
  daysLeft?: number;
  wrongKey?: boolean;
};

export type DesktopBridge = {
  isDesktop: boolean;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  saveRecording: (bytes: ArrayBuffer, name: string, extension?: string) => Promise<string>;
  /** `pairedVideo` names the recording this MIDI belongs to, so they can be found together. */
  saveMidi?: (bytes: ArrayBuffer, name: string, pairedVideo?: string) => Promise<string>;
  saveProject: (project: unknown) => Promise<string>;
  listProjects: () => Promise<ProjectSummary[]>;
  /** Read a saved project back. Restricted to the projects folder. */
  readProject?: (filePath: string) => Promise<Record<string, unknown>>;
  listRecordings: () => Promise<RecordingSummary[]>;
  openPath: (target: string) => Promise<string>;
  openLibraryFolder: (kind: 'projects' | 'recordings') => Promise<string>;
  loadSettings: () => Promise<Record<string, unknown>>;
  saveSettings: (value: unknown) => Promise<string>;
  /** Virtual instruments installed on this PC. Scanning only; nothing is hosted. */
  scanPlugins?: () => Promise<Array<{
    path: string; fileName: string; extension: string; vendor?: string; launchable: boolean;
  }>>;
  /** Start a standalone instrument that the scan found. */
  launchPlugin?: (target: string) => Promise<string>;
  /** Rename a saved project. Returns the new file path. */
  renameProject?: (filePath: string, name: string) => Promise<string>;
  /** Permanently remove a saved project or recording. */
  deleteProject?: (filePath: string) => Promise<string>;
  deleteRecording?: (filePath: string) => Promise<string>;
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
      /** Which shape's encoder this is; each runs independently. */
      output?: 'primary' | 'secondary';
    },
  ) => Promise<{ ok: boolean; message?: string; destinations?: string[] }>;
  streamStop?: (output?: 'primary' | 'secondary') => Promise<{ ok: boolean }>;
  streamStatus?: (output?: 'primary' | 'secondary') => Promise<StreamStatusBridge>;
  /** One chunk of recorded WebM, forwarded to that output's ffmpeg. */
  streamChunk?: (bytes: ArrayBuffer, output?: 'primary' | 'secondary') => void;
  onStreamStatus?: (handler: (status: StreamStatusBridge) => void) => () => void;

  /* Stem separation. Runs on this computer, in a process of its own. */
  stemStatus?: () => Promise<{ modelReady: boolean; modelBytes: number; busy: boolean; stems: StemName[] }>;
  /** Fetch the separation network. Once only; about 136 MB. */
  stemDownload?: () => Promise<boolean>;
  /** Separate a 44.1 kHz stereo recording. Resolves with the song's fingerprint. */
  stemSeparate?: (left: ArrayBuffer, right: ArrayBuffer) => Promise<{ id: string; cached: boolean; stems: StemName[] }>;
  stemCancel?: () => Promise<void>;
  /** One separated stem, as a WAV file's bytes. */
  stemRead?: (id: string, stem: StemName) => Promise<ArrayBuffer>;
  onStemProgress?: (handler: (progress: { stage: 'download' | 'separate'; fraction: number }) => void) => () => void;

  /**
   * The Learn library. A "song" here is a stem fingerprint plus the facts
   * around it — its audio is never stored a second time; reopening a song
   * rebuilds the mix by summing its already-cached stems.
   */
  /** The test-build gate: one shared key and an end date. Not the licence system. */
  betaStatus?: () => Promise<BetaStatus>;
  betaActivate?: (key: string) => Promise<BetaStatus>;
  /** Pack a recording and its MIDI into one file, asking where to put it. Null if cancelled. */
  shareLesson?: (videoPath: string) => Promise<{ path: string; withMidi: boolean } | null>;
  /** The bytes of a lesson file somebody sent. Only lesson files can be read this way. */
  readLesson?: (filePath: string) => Promise<{ name: string; bytes: ArrayBuffer }>;
  /** A recording of your own, with its MIDI, to study as a student would. */
  readRecordingLesson?: (videoPath: string) => Promise<{
    name: string; type: string; video: ArrayBuffer; midi: ArrayBuffer | null;
  }>;
  /** A lesson the app was started by opening, once. */
  takePendingLesson?: () => Promise<string | null>;
  /** A lesson opened while the app was already running. */
  onOpenLesson?: (handler: (filePath: string) => void) => () => void;
  saveLearnSong?: (entry: unknown) => Promise<string>;
  listLearnSongs?: () => Promise<unknown[]>;
  deleteLearnSong?: (id: string) => Promise<string>;
};

declare global {
  interface Window {
    pianoTutorDesktop?: DesktopBridge;
  }
}

export {};
