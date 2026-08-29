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

export type DesktopBridge = {
  isDesktop: boolean;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  saveRecording: (bytes: ArrayBuffer, name: string, extension?: string) => Promise<string>;
  saveMidi?: (bytes: ArrayBuffer, name: string) => Promise<string>;
  saveProject: (project: unknown) => Promise<string>;
  listProjects: () => Promise<ProjectSummary[]>;
  listRecordings: () => Promise<RecordingSummary[]>;
  openPath: (target: string) => Promise<string>;
  openLibraryFolder: (kind: 'projects' | 'recordings') => Promise<string>;
  loadSettings: () => Promise<Record<string, unknown>>;
  saveSettings: (value: unknown) => Promise<string>;
  /** Absolute paths of the library folders, for display in Settings. */
  paths?: () => Promise<{ projects: string; recordings: string }>;
};

declare global {
  interface Window {
    pianoTutorDesktop?: DesktopBridge;
  }
}

export {};
