/**
 * Application settings, persisted by the desktop shell and falling back to
 * localStorage in the browser so preferences survive a reload either way.
 */

import { QUALITY_PRESETS } from './recorder';
import { normalizeScenes, type Scene } from './scene';

export type AppSettings = {
  /** Key into QUALITY_PRESETS. */
  quality: keyof typeof QUALITY_PRESETS | string;
  recordAudio: boolean;
  recordMidi: boolean;
  autosave: boolean;
  /** Concert pitch in Hz — ISO 16 is 440. */
  concertPitch: number;
  /** Sharp or flat spelling for note and chord names. */
  accidental: 'sharp' | 'flat';
  keyRoot: number;
  mode: 'major' | 'minor';
  keyboardSize: '25' | '37' | '49' | '61' | '76' | '88';
  showAllLabels: boolean;
  highlightScale: boolean;
  computerKeyOctave: number;
  masterLevel: number;
  monitorLevel: number;
  limiter: boolean;
  ducking: boolean;
  duckingAmountDb: number;
  midiEcho: boolean;
  outputDeviceId: string;
  /** Which physical camera fills each teaching role. */
  faceCameraId: string;
  handCameraId: string;
  /** Interface language tag (BCP 47), used for date and number formatting. */
  locale: string;
  theme: 'midnight' | 'graphite' | 'contrast';
};

export const DEFAULT_SETTINGS: AppSettings = {
  quality: '1080p30',
  recordAudio: true,
  recordMidi: true,
  autosave: true,
  concertPitch: 440,
  accidental: 'sharp',
  keyRoot: 0,
  mode: 'major',
  keyboardSize: '61',
  showAllLabels: false,
  highlightScale: false,
  computerKeyOctave: 0,
  masterLevel: 0.8,
  monitorLevel: 0.8,
  limiter: true,
  ducking: true,
  duckingAmountDb: -6,
  midiEcho: false,
  outputDeviceId: '',
  faceCameraId: '',
  handCameraId: '',
  locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
  theme: 'midnight',
};

const STORAGE_KEY = 'pianotutor.settings.v1';

/** Merge stored values over the defaults, dropping anything unrecognised. */
export function normalizeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const input = raw as Record<string, unknown>;
  const result = { ...DEFAULT_SETTINGS };
  (Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>).forEach(key => {
    const value = input[key];
    if (value === undefined || value === null) return;
    if (typeof DEFAULT_SETTINGS[key] === typeof value) {
      (result as Record<string, unknown>)[key] = value;
    }
  });
  // Guard the numeric ranges that would otherwise break the audio engine.
  result.concertPitch = Math.min(466, Math.max(392, Number(result.concertPitch) || 440));
  result.masterLevel = Math.min(1, Math.max(0, Number(result.masterLevel)));
  result.monitorLevel = Math.min(1, Math.max(0, Number(result.monitorLevel)));
  result.keyRoot = ((Math.round(Number(result.keyRoot)) % 12) + 12) % 12;
  result.computerKeyOctave = Math.min(3, Math.max(-3, Math.round(Number(result.computerKeyOctave)) || 0));
  if (!QUALITY_PRESETS[result.quality]) result.quality = DEFAULT_SETTINGS.quality;
  return result;
}

export async function loadSettings(): Promise<AppSettings> {
  const desktop = window.pianoTutorDesktop;
  if (desktop?.loadSettings) {
    try {
      return normalizeSettings(await desktop.loadSettings());
    } catch { /* fall through to localStorage */ }
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist settings. Returns the file path when saved by the desktop shell. */
export async function saveSettings(settings: AppSettings): Promise<string | undefined> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* private mode or quota — the desktop path below still applies */ }
  const desktop = window.pianoTutorDesktop;
  if (desktop?.saveSettings) {
    try { return await desktop.saveSettings(settings); } catch { return undefined; }
  }
  return undefined;
}

/** Format a byte count for display using the viewer's locale. */
export function formatBytes(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const megabytes = bytes / 1_048_576;
  if (megabytes < 1) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes / 1024)} KB`;
  }
  if (megabytes >= 1024) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(megabytes / 1024)} GB`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(megabytes)} MB`;
}

/** Format an elapsed duration as HH:MM:SS, correct beyond 24 hours. */
export function formatDuration(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Locale-aware date and time for library listings. */
export function formatDateTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/* ------------------------------------------------------------------ *
 * Scene persistence
 *
 * Scenes live in the same store as the preferences but are kept as their own
 * field, so a malformed scene can never corrupt the settings and vice versa.
 * ------------------------------------------------------------------ */

const SCENES_KEY = 'pianotutor.scenes.v1';

export type PersistedScenes = { scenes: Scene[]; activeSceneId?: string };

async function readRawStore(): Promise<Record<string, unknown>> {
  const desktop = window.pianoTutorDesktop;
  if (desktop?.loadSettings) {
    try {
      const raw = await desktop.loadSettings();
      if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
    } catch { /* fall through to localStorage */ }
  }
  try {
    const stored = localStorage.getItem(SCENES_KEY);
    return stored ? (JSON.parse(stored) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function loadScenes(): Promise<PersistedScenes> {
  const raw = await readRawStore();
  const scenes = normalizeScenes(raw.scenes);
  const activeSceneId = typeof raw.activeSceneId === 'string' ? raw.activeSceneId : undefined;
  return { scenes, activeSceneId: scenes.some(s => s.id === activeSceneId) ? activeSceneId : scenes[0]?.id };
}

/**
 * Write settings and scenes together. They share one file, so both are always
 * persisted as a unit rather than one overwriting the other.
 */
export async function savePersisted(settings: AppSettings, state: PersistedScenes): Promise<string | undefined> {
  const payload = { ...settings, scenes: state.scenes, activeSceneId: state.activeSceneId };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem(SCENES_KEY, JSON.stringify({ scenes: state.scenes, activeSceneId: state.activeSceneId }));
  } catch { /* private mode or quota */ }
  const desktop = window.pianoTutorDesktop;
  if (desktop?.saveSettings) {
    try { return await desktop.saveSettings(payload); } catch { return undefined; }
  }
  return undefined;
}
