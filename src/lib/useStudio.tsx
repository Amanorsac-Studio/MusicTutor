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
  DEFAULT_SETTINGS, loadScenes, loadSettings, savePersisted, saveSettings, type AppSettings,
} from './settings';
import {
  createId, createScene, createSource, type Scene, type Source, type SourceKind,
} from './scene';
import { sceneCompositor } from './compositor';
import { INPUT_SLOTS } from './inputs';
import { detectChord, romanNumeral } from './chords';

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
  /** Choose which input channel drives the ducking sidechain. */
  setDuckingTrigger: (id: string) => void;

  scenes: Scene[];
  activeSceneId: string;
  activeScene: Scene | undefined;
  selectScene: (id: string) => void;
  addScene: (name?: string) => string;
  duplicateScene: (id: string) => void;
  renameScene: (id: string, name: string) => void;
  deleteScene: (id: string) => void;
  /** Replace the source list of the active scene. */
  setSceneSources: (sources: Source[]) => void;
  addSource: (kind: SourceKind, overrides?: Partial<Source>) => string | null;
  updateSource: (id: string, patch: Partial<Source>) => void;
  removeSource: (id: string) => void;
  selectedSourceId: string | null;
  setSelectedSourceId: (id: string | null) => void;

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

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [activeSceneId, setActiveSceneId] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const { catalog, refresh } = useDeviceCatalog();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const activeScene = scenes.find(scene => scene.id === activeSceneId);
  const activeSceneRef = useRef(activeScene);
  activeSceneRef.current = activeScene;

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

  const persistSettings = useCallback(
    () => savePersisted(settingsRef.current, { scenes: scenesRef.current, activeSceneId: activeSceneIdRef.current }),
    [],
  );

  /* -------------------------------------------------- scenes --------- */

  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const activeSceneIdRef = useRef(activeSceneId);
  activeSceneIdRef.current = activeSceneId;

  useEffect(() => {
    let cancelled = false;
    void loadScenes().then(stored => {
      if (cancelled) return;
      // A fresh install gets one empty scene to work in. Creating it here rather
      // than in a component effect avoids the new scene being wiped when this
      // asynchronous load resolves with an empty list.
      const scenes = stored.scenes.length ? stored.scenes : [createScene('My scene')];
      setScenes(scenes);
      setActiveSceneId(stored.activeSceneId ?? scenes[0]?.id ?? '');
    });
    return () => { cancelled = true; };
  }, []);

  const selectScene = useCallback((id: string) => {
    setActiveSceneId(id);
    setSelectedSourceId(null);
  }, []);

  const addScene = useCallback((name?: string) => {
    const scene = createScene(name || `Scene ${scenesRef.current.length + 1}`);
    setScenes(current => [...current, scene]);
    setActiveSceneId(scene.id);
    setSelectedSourceId(null);
    return scene.id;
  }, []);

  const duplicateScene = useCallback((id: string) => {
    const original = scenesRef.current.find(scene => scene.id === id);
    if (!original) return;
    const copy: Scene = {
      id: createId('scene'),
      name: `${original.name} copy`,
      // Fresh ids so the two scenes never share a source.
      sources: original.sources.map(source => ({ ...source, id: createId(source.kind), props: { ...source.props } })),
    };
    setScenes(current => [...current, copy]);
    setActiveSceneId(copy.id);
  }, []);

  const renameScene = useCallback((id: string, name: string) => {
    setScenes(current => current.map(scene => (scene.id === id ? { ...scene, name } : scene)));
  }, []);

  const deleteScene = useCallback((id: string) => {
    setScenes(current => {
      const next = current.filter(scene => scene.id !== id);
      setActiveSceneId(previous => (previous === id ? next[0]?.id ?? '' : previous));
      return next;
    });
    setSelectedSourceId(null);
  }, []);

  const setSceneSources = useCallback((sources: Source[]) => {
    setScenes(current => current.map(scene =>
      (scene.id === activeSceneIdRef.current ? { ...scene, sources } : scene)));
  }, []);

  const addSource = useCallback((kind: SourceKind, overrides?: Partial<Source>) => {
    if (!activeSceneIdRef.current) return null;
    const source = createSource(kind, overrides);
    setScenes(current => current.map(scene => {
      if (scene.id !== activeSceneIdRef.current) return scene;
      // A backdrop is scenery: it always goes behind everything else, so adding
      // one never hides the layout you have already built.
      const sources = kind === 'backdrop'
        ? [source, ...scene.sources]
        : [...scene.sources, source];
      return { ...scene, sources };
    }));
    setSelectedSourceId(source.id);
    return source.id;
  }, []);

  const updateSource = useCallback((id: string, patch: Partial<Source>) => {
    setScenes(current => current.map(scene => {
      if (scene.id !== activeSceneIdRef.current) return scene;
      return {
        ...scene,
        sources: scene.sources.map(source => (source.id === id
          ? { ...source, ...patch, props: { ...source.props, ...(patch.props ?? {}) } }
          : source)),
      };
    }));
  }, []);

  const removeSource = useCallback((id: string) => {
    setScenes(current => current.map(scene =>
      (scene.id === activeSceneIdRef.current
        ? { ...scene, sources: scene.sources.filter(source => source.id !== id) }
        : scene)));
    setSelectedSourceId(previous => (previous === id ? null : previous));
  }, []);

  // Feed the compositor from refs rather than state, so it always paints the
  // current scene without the provider being rebuilt on every edit.
  const activeNotesRef = useRef(activeNotes);
  activeNotesRef.current = activeNotes;

  useEffect(() => {
    const images = new Map<string, CanvasImageSource>();
    sceneCompositor.setProvider(() => {
      const notes = activeNotesRef.current;
      const chord = detectChord(notes, settingsRef.current.accidental);
      const numeral = chord
        ? romanNumeral(chord, settingsRef.current.keyRoot, settingsRef.current.mode)
        : null;
      return {
        sources: activeSceneRef.current?.sources ?? [],
        context: {
          activeNotes: notes,
          accidental: settingsRef.current.accidental,
          chordSymbol: chord?.symbol,
          chordNumeral: numeral ?? undefined,
          chordQuality: chord?.quality,
          images,
        },
      };
    });
    // Painting continuously keeps the canvas warm, so starting a recording
    // never captures a blank first frame.
    sceneCompositor.start(30);
    return () => sceneCompositor.stop();
  }, []);

  // Autosave scene edits, debounced so dragging a source does not thrash disk.
  useEffect(() => {
    if (!settingsLoaded || !settings.autosave) return;
    const id = window.setTimeout(() => {
      void savePersisted(settingsRef.current, { scenes: scenesRef.current, activeSceneId: activeSceneIdRef.current });
    }, 700);
    return () => window.clearTimeout(id);
  }, [scenes, activeSceneId, settingsLoaded, settings.autosave]);

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
    // The standard strips exist from startup so the Mixer always shows a full
    // desk, with working faders, before anything is plugged in.
    INPUT_SLOTS.forEach(slot => audioEngine.ensureChannel({
      id: slot.id, label: slot.label, isVoice: slot.isVoice,
    }));
    syncChannels();
  }, [syncChannels]);

  const attachInput = useCallback(async (options: { id: string; label: string; deviceId?: string; isVoice?: boolean }) => {
    const state = await audioEngine.addInputChannel(options);
    syncChannels();
    if (state.error) setNotice(`${options.label}: ${state.error}`);
    return state;
  }, [syncChannels]);

  const detachInput = useCallback((id: string) => {
    // Standard slots keep their strip on the desk; only the device is released.
    if (INPUT_SLOTS.some(slot => slot.id === id)) audioEngine.clearChannelDevice(id);
    else audioEngine.removeChannel(id);
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

  const setDuckingTrigger = useCallback((id: string) => {
    // Exactly one input channel drives the sidechain at a time.
    audioEngine.listChannels().forEach(channel => {
      if (channel.kind === 'input') audioEngine.setChannelVoice(channel.id, channel.id === id);
    });
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
    let sinceCommit = 0;
    let previous: Record<string, ChannelLevel> = {};

    // Only re-render when a meter would visibly move. While nothing is playing
    // this settles to zero renders per second instead of forty.
    const worthRendering = (next: Record<string, ChannelLevel>): boolean => {
      const keys = Object.keys(next);
      if (keys.length !== Object.keys(previous).length) return true;
      return keys.some(key => {
        const a = previous[key];
        const b = next[key];
        if (!a) return true;
        return Math.abs(a.meter - b.meter) > 0.004 || a.clipping !== b.clipping;
      });
    };

    const id = window.setInterval(() => {
      if (disposed) return;
      const reading = audioEngine.readLevels();
      // Ducking follows every tick; the display is throttled below.
      audioEngine.updateDucking(reading);

      sinceCommit += 25;
      if (sinceCommit < 50) return;
      sinceCommit = 0;
      if (!worthRendering(reading)) return;
      previous = reading;
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
    channels, levels, attachInput, detachInput, setChannelGain, setChannelMuted, setChannelSolo, setDuckingTrigger,
    scenes, activeSceneId, activeScene, selectScene, addScene, duplicateScene, renameScene, deleteScene,
    setSceneSources, addSource, updateSource, removeSource, selectedSourceId, setSelectedSourceId,
    activeNotes, noteOn, noteOff, panic,
    recording, elapsedMs, startRecording, stopRecording,
    notice, setNotice,
  }), [
    settings, updateSettings, persistSettings, settingsLoaded,
    catalog, refresh, channels, levels, attachInput, detachInput,
    setChannelGain, setChannelMuted, setChannelSolo, setDuckingTrigger,
    scenes, activeSceneId, activeScene, selectScene, addScene, duplicateScene, renameScene, deleteScene,
    setSceneSources, addSource, updateSource, removeSource, selectedSourceId,
    activeNotes, noteOn, noteOff, panic,
    recording, elapsedMs, startRecording, stopRecording, notice,
  ]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}
