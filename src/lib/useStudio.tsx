/**
 * Shared studio state: settings, devices, mixer channels, live levels, the
 * sounding-note set, and recording. One instance is created at the app root and
 * shared through context, so the Studio, Devices and Mixer pages all act on the
 * same audio engine instead of each keeping their own disconnected copy.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { audioEngine, type ChannelLevel, type ChannelState } from './audioEngine';
import { midiManager } from './midi';
import { useDeviceCatalog, type DeviceCatalog } from './devices';
import { lessonRecorder, QUALITY_PRESETS } from './recorder';
import {
  DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings,
} from './settings';

export type StudioValue = {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  persistSettings: () => Promise<string | undefined>;
  settingsLoaded: boolean;

  catalog: DeviceCatalog;
  refreshDevices: (requestPermission?: boolean) => Promise<void>;

  channels: ChannelState[];
  levels: Record<string, ChannelLevel>;
  attachInput: (options: { id: string; label: string; deviceId?: string; isVoice?: boolean }) => Promise<ChannelState>;
  detachInput: (id: string) => void;
  setChannelGain: (id: string, value: number) => void;
  setChannelMuted: (id: string, value: boolean) => void;
  setChannelSolo: (id: string, value: boolean) => void;

  activeNotes: Set<number>;
  noteOn: (note: number, velocity: number) => void;
  noteOff: (note: number) => void;
  panic: () => void;

  recording: boolean;
  elapsedMs: number;
  startRecording: () => Promise<void>;
  stopRecording: (name?: string) => Promise<void>;

  notice: string;
  setNotice: (message: string) => void;
};

const StudioContext = createContext<StudioValue | null>(null);

export function useStudio(): StudioValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error('useStudio must be used inside <StudioProvider>');
  return value;
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [levels, setLevels] = useState<Record<string, ChannelLevel>>({});
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [notice, setNotice] = useState('');

  const { catalog, refresh } = useDeviceCatalog();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* -------------------------------------------------- settings ------- */

  useEffect(() => {
    let cancelled = false;
    void loadSettings().then(loaded => {
      if (cancelled) return;
      setSettings(loaded);
      setSettingsLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings(current => ({ ...current, ...patch }));
  }, []);

  const persistSettings = useCallback(() => saveSettings(settingsRef.current), []);

  // Push settings that the audio engine needs to know about.
  useEffect(() => {
    if (!settingsLoaded) return;
    audioEngine.concertPitch = settings.concertPitch;
    audioEngine.setMasterGain(settings.masterLevel);
    audioEngine.setMonitorGain(settings.monitorLevel);
    audioEngine.setLimiterEnabled(settings.limiter);
    audioEngine.setDucking({ enabled: settings.ducking, amountDb: settings.duckingAmountDb });
    midiManager.setEcho(settings.midiEcho);
  }, [
    settingsLoaded, settings.concertPitch, settings.masterLevel, settings.monitorLevel,
    settings.limiter, settings.ducking, settings.duckingAmountDb, settings.midiEcho,
  ]);

  // Autosave preference changes, debounced so a dragged slider does not thrash disk.
  useEffect(() => {
    if (!settingsLoaded || !settings.autosave) return;
    const id = window.setTimeout(() => { void saveSettings(settings); }, 800);
    return () => window.clearTimeout(id);
  }, [settings, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || !settings.outputDeviceId) return;
    void audioEngine.setOutputDevice(settings.outputDeviceId);
  }, [settingsLoaded, settings.outputDeviceId]);

  /* -------------------------------------------------- notes ---------- */

  const noteOn = useCallback((note: number, velocity: number) => {
    audioEngine.noteOn(note, velocity);
    if (midiManager.selectedOutputId) midiManager.sendNoteOn(note, velocity);
    if (lessonRecorder.midi.recording) lessonRecorder.midi.noteOn(note, velocity);
  }, []);

  const noteOff = useCallback((note: number) => {
    audioEngine.noteOff(note);
    if (midiManager.selectedOutputId) midiManager.sendNoteOff(note);
    if (lessonRecorder.midi.recording) lessonRecorder.midi.noteOff(note);
  }, []);

  const panic = useCallback(() => {
    audioEngine.allNotesOff();
    midiManager.sendAllNotesOff();
    setActiveNotes(new Set());
  }, []);

  // The engine is the single source of truth for what is sounding.
  useEffect(() => audioEngine.subscribe((note, on) => {
    setActiveNotes(current => {
      const next = new Set(current);
      if (on) next.add(note);
      else next.delete(note);
      return next;
    });
  }), []);

  /* -------------------------------------------------- MIDI in -------- */

  useEffect(() => {
    void midiManager.connect();
    return midiManager.subscribe(event => {
      switch (event.type) {
        case 'noteon':
          audioEngine.noteOn(event.note, event.velocity);
          // Echo to a hardware output only when explicitly enabled; echoing by
          // default feeds a keyboard's own notes back to it.
          if (midiManager.echoEnabled) midiManager.sendNoteOn(event.note, event.velocity);
          if (lessonRecorder.midi.recording) lessonRecorder.midi.noteOn(event.note, event.velocity);
          break;
        case 'noteoff':
          audioEngine.noteOff(event.note);
          if (midiManager.echoEnabled) midiManager.sendNoteOff(event.note);
          if (lessonRecorder.midi.recording) lessonRecorder.midi.noteOff(event.note);
          break;
        case 'sustain':
          audioEngine.setSustain(event.down);
          if (lessonRecorder.midi.recording) lessonRecorder.midi.sustain(event.down);
          break;
        case 'allnotesoff':
          audioEngine.allNotesOff();
          break;
        default:
          break;
      }
    });
  }, []);

  /* -------------------------------------------------- channels ------- */

  const syncChannels = useCallback(() => setChannels(audioEngine.listChannels()), []);

  useEffect(() => {
    audioEngine.ensure();
    syncChannels();
  }, [syncChannels]);

  const attachInput = useCallback(async (options: { id: string; label: string; deviceId?: string; isVoice?: boolean }) => {
    const state = await audioEngine.addInputChannel(options);
    syncChannels();
    if (state.error) setNotice(`${options.label}: ${state.error}`);
    return state;
  }, [syncChannels]);

  const detachInput = useCallback((id: string) => {
    audioEngine.removeChannel(id);
    syncChannels();
  }, [syncChannels]);

  const setChannelGain = useCallback((id: string, value: number) => {
    audioEngine.setChannelGain(id, value);
    syncChannels();
  }, [syncChannels]);

  const setChannelMuted = useCallback((id: string, value: boolean) => {
    audioEngine.setChannelMuted(id, value);
    syncChannels();
  }, [syncChannels]);

  const setChannelSolo = useCallback((id: string, value: boolean) => {
    audioEngine.setChannelSolo(id, value);
    syncChannels();
  }, [syncChannels]);

  /* -------------------------------------------------- metering ------- */

  // Metering and ducking share one 40 Hz timer.
  //
  // This deliberately does not use requestAnimationFrame: rAF stops completely
  // while the window is hidden or minimised, which would freeze the ducking
  // gain mid-recording — the one moment it must keep working. A timer keeps
  // running (the desktop shell disables background throttling), and 40 Hz is
  // far more resolution than a level meter needs anyway.
  useEffect(() => {
    let disposed = false;
    const id = window.setInterval(() => {
      if (disposed) return;
      const reading = audioEngine.readLevels();
      audioEngine.updateDucking(reading);
      setLevels(reading);
    }, 25);
    return () => { disposed = true; window.clearInterval(id); };
  }, []);

  /* -------------------------------------------------- recording ------ */

  const startRecording = useCallback(async () => {
    const current = settingsRef.current;
    try {
      await audioEngine.resume();
      await lessonRecorder.start({
        quality: QUALITY_PRESETS[current.quality] ?? QUALITY_PRESETS['1080p30'],
        recordAudio: current.recordAudio,
        recordMidi: current.recordMidi,
      });
      setRecording(true);
      setElapsedMs(0);
      setNotice('Recording started');
    } catch (error) {
      setRecording(false);
      setNotice(error instanceof Error ? error.message : 'Recording could not start');
    }
  }, []);

  const stopRecording = useCallback(async (name = 'Piano_Lesson') => {
    try {
      const result = await lessonRecorder.stop(name);
      setRecording(false);
      setElapsedMs(0);
      if (result.videoPath) {
        setNotice(result.midiPath ? `Saved video and MIDI to ${result.videoPath}` : `Saved to ${result.videoPath}`);
      } else if (result.bytes) {
        setNotice('Recording finished. Install the desktop app to save it to disk.');
      } else {
        setNotice('Recording stopped');
      }
    } catch (error) {
      setRecording(false);
      setNotice(error instanceof Error ? error.message : 'Recording failed to save');
    }
  }, []);

  // Drive the elapsed clock from the recorder itself, so it reflects the real
  // capture length rather than counting interval ticks that may be throttled.
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setElapsedMs(lessonRecorder.elapsedMs), 250);
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const value = useMemo<StudioValue>(() => ({
    settings, updateSettings, persistSettings, settingsLoaded,
    catalog, refreshDevices: refresh,
    channels, levels, attachInput, detachInput, setChannelGain, setChannelMuted, setChannelSolo,
    activeNotes, noteOn, noteOff, panic,
    recording, elapsedMs, startRecording, stopRecording,
    notice, setNotice,
  }), [
    settings, updateSettings, persistSettings, settingsLoaded,
    catalog, refresh, channels, levels, attachInput, detachInput,
    setChannelGain, setChannelMuted, setChannelSolo,
    activeNotes, noteOn, noteOff, panic,
    recording, elapsedMs, startRecording, stopRecording, notice,
  ]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}
