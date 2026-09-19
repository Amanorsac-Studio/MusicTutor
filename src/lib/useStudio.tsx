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
  DEFAULT_SETTINGS, loadScenes, loadSettings, normalizeSettings, savePersisted, saveSettings, type AppSettings,
} from './settings';
import {
  createId, createScene, createSource, layoutFor, normalizeScenes, rescaleLayout, reorderBy, withLayout,
  type Scene, type Source, type SourceKind,
} from './scene';
import {
  getFormat, getResolution, renderSize, type OutputFormatId, type QualityLevel,
} from './formats';
import { sceneCompositor, secondaryCompositor } from './compositor';
import { INPUT_SLOTS } from './inputs';
import { detectChord, noteName, romanNumeral } from './chords';
import { NoteTracker, decimate, detectPitch, type TrackedNote } from './pitch';
import { BASS_TUNINGS, likelyPosition, noteDegree, positionsFor, type FretPosition } from './fretboard';

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

  /** The output shape being edited and recorded. */
  format: OutputFormatId;
  setFormat: (id: OutputFormatId) => void;
  /** Layout space for the current format. */
  canvasSize: { width: number; height: number };
  /** Copy another format's arrangement into the current one, rescaled. */
  seedLayoutFrom: (from: OutputFormatId) => void;

  scenes: Scene[];
  activeSceneId: string;
  activeScene: Scene | undefined;
  /** Sources of the active scene in the current format. */
  sources: Source[];
  reorderScene: (id: string, direction: 'up' | 'down') => void;
  selectScene: (id: string) => void;
  addScene: (name?: string) => string;
  duplicateScene: (id: string) => void;
  renameScene: (id: string, name: string) => void;
  deleteScene: (id: string) => void;
  /** Replace the source list of the active scene. */
  setSceneSources: (sources: Source[]) => void;
  /** Save every scene and preference as a reopenable project file. */
  saveProjectFile: (name: string) => Promise<string | undefined>;
  openProjectFile: (filePath: string) => Promise<void>;
  /** The note the bass is playing, in bass mode; null when silent or in piano mode. */
  bassNote: TrackedNote | null;
  /** Where on the neck that note was most likely played. */
  bassPosition: FretPosition | null;
  /** The project currently open, if one was opened or saved this session. */
  openProject: { name: string; filePath: string } | null;
  /** Write over the open project. Does nothing when none is open. */
  updateProject: () => Promise<string | undefined>;
  /** True when something has changed since the open project was last written. */
  projectDirty: boolean;
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
  const [format, setFormatState] = useState<OutputFormatId>('landscape');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const { catalog, refresh } = useDeviceCatalog();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const activeScene = scenes.find(scene => scene.id === activeSceneId);
  const activeSceneRef = useRef(activeScene);
  activeSceneRef.current = activeScene;

  const canvasSize = useMemo(() => {
    const spec = getFormat(format);
    return { width: spec.width, height: spec.height };
  }, [format]);
  const canvasSizeRef = useRef(canvasSize);
  canvasSizeRef.current = canvasSize;

  const formatRef = useRef(format);
  formatRef.current = format;

  const secondaryFormatRef = useRef(settings.secondaryFormat);
  secondaryFormatRef.current = settings.secondaryFormat;

  const sources = layoutFor(activeScene, format);

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
    const layouts: Scene['layouts'] = {};
    // Fresh ids so the two scenes never share a source, across every format.
    (Object.keys(original.layouts) as OutputFormatId[]).forEach(formatId => {
      layouts[formatId] = (original.layouts[formatId] ?? []).map(source =>
        ({ ...source, id: createId(source.kind), props: { ...source.props } }));
    });
    const copy: Scene = { id: createId('scene'), name: `${original.name} copy`, layouts };
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

  const setSceneSources = useCallback((next: Source[]) => {
    setScenes(current => current.map(scene =>
      (scene.id === activeSceneIdRef.current ? withLayout(scene, formatRef.current, next) : scene)));
  }, []);

  /** Move a scene in the list, so the running order is the teacher's choice. */
  const reorderScene = useCallback((id: string, direction: 'up' | 'down') => {
    setScenes(current => {
      const index = current.findIndex(scene => scene.id === id);
      if (index < 0) return current;
      // The list reads top-down, so "up" means earlier.
      return reorderBy(current, index, direction === 'up' ? 'down' : 'up');
    });
  }, []);

  /**
   * Save the whole setup as a project file: every scene, every format's layout,
   * and the preferences that go with them.
   *
   * This is what distinguishes a project from a recording. A recording is the
   * finished video; a project is the arrangement that produced it, so the same
   * lesson set-up can be reopened next week.
   */
  /**
   * Which project is open, so it can be updated rather than only saved anew.
   *
   * Without this every save made another file, and a teacher adjusting a
   * lesson ended up with a folder of near-identical projects and no idea which
   * one was current.
   */
  const [openProject, setOpenProject] = useState<{ name: string; filePath: string } | null>(null);
  const [projectDirty, setProjectDirty] = useState(false);
  const openProjectRef = useRef(openProject);
  openProjectRef.current = openProject;

  const saveProjectFile = useCallback(async (name: string) => {
    const desktop = window.pianoTutorDesktop;
    if (!desktop?.saveProject) {
      setNotice('Projects are saved by the installed desktop app.');
      return undefined;
    }
    const path = await desktop.saveProject({
      name,
      kind: 'musictutor-project',
      version: 2,
      scenes: scenesRef.current,
      activeSceneId: activeSceneIdRef.current,
      settings: settingsRef.current,
      scene: scenesRef.current.find(item => item.id === activeSceneIdRef.current)?.name ?? 'Scene',
    }).catch(() => undefined);
    if (path) {
      setOpenProject({ name, filePath: path });
      setProjectDirty(false);
    }
    setNotice(path ? `Saved “${name}” to ${path}` : 'The project could not be saved');
    return path;
  }, []);

  /** Write the current state over the project that is already open. */
  const updateProject = useCallback(async () => {
    const current = openProjectRef.current;
    if (!current) return undefined;
    const path = await saveProjectFile(current.name);
    if (path) setNotice(`Updated “${current.name}”`);
    return path;
  }, [saveProjectFile]);

  /** Reopen a saved setup, replacing the current scenes and preferences. */
  const openProjectFile = useCallback(async (filePath: string) => {
    const desktop = window.pianoTutorDesktop;
    if (!desktop?.readProject) {
      setNotice('Opening projects needs the installed desktop app.');
      return;
    }
    try {
      const raw = await desktop.readProject(filePath);
      const restored = normalizeScenes((raw as { scenes?: unknown }).scenes);
      if (!restored.length) {
        setNotice('That project has no scenes in it.');
        return;
      }
      setScenes(restored);
      const wanted = (raw as { activeSceneId?: string }).activeSceneId;
      setActiveSceneId(restored.some(item => item.id === wanted) ? wanted! : restored[0].id);
      setSelectedSourceId(null);
      const storedSettings = (raw as { settings?: unknown }).settings;
      if (storedSettings) setSettings(normalizeSettings(storedSettings));
      const name = (raw as { name?: string }).name ?? 'project';
      setOpenProject({ name, filePath });
      setProjectDirty(false);
      setNotice(`Opened “${name}”`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That project could not be opened.');
    }
  }, []);

  /**
   * Note that the lesson has moved on from what is on disk.
   *
   * Edits come from a dozen places, so rather than remembering to flag each
   * one, the scenes and the settings are watched and any change marks the
   * project unsaved.
   */
  useEffect(() => {
    if (!openProjectRef.current) return;
    setProjectDirty(true);
  }, [scenes, settings, format]);

  const setFormat = useCallback((id: OutputFormatId) => {
    setFormatState(id);
    setSelectedSourceId(null);
    // Making the main shape the same as the second would compose one picture
    // twice and record two identical files, so the second stands down.
    if (settingsRef.current.secondaryFormat === id) {
      setSettings(current => ({ ...current, secondaryFormat: 'off' }));
    }
  }, []);

  /** Start this format's layout from another one, rescaled to fit. */
  const seedLayoutFrom = useCallback((from: OutputFormatId) => {
    const scene = activeSceneRef.current;
    if (!scene) return;
    const target = formatRef.current;
    if (from === target) return;
    const fromSpec = getFormat(from);
    const toSpec = getFormat(target);
    const rescaled = rescaleLayout(
      layoutFor(scene, from).map(source => ({ ...source, id: createId(source.kind), props: { ...source.props } })),
      { width: fromSpec.width, height: fromSpec.height },
      { width: toSpec.width, height: toSpec.height },
    );
    setScenes(current => current.map(item =>
      (item.id === scene.id ? withLayout(item, target, rescaled) : item)));
    setNotice(`Copied the ${fromSpec.short.toLowerCase()} layout into ${toSpec.short.toLowerCase()}.`);
  }, []);

  const addSource = useCallback((kind: SourceKind, overrides?: Partial<Source>) => {
    if (!activeSceneIdRef.current) return null;
    const source = createSource(kind, canvasSizeRef.current, overrides);
    setScenes(current => current.map(scene => {
      if (scene.id !== activeSceneIdRef.current) return scene;
      const existing = layoutFor(scene, formatRef.current);
      // A backdrop is scenery: it always goes behind everything else, so adding
      // one never hides the layout you have already built.
      const next = kind === 'backdrop' ? [source, ...existing] : [...existing, source];
      return withLayout(scene, formatRef.current, next);
    }));
    setSelectedSourceId(source.id);
    return source.id;
  }, []);

  const updateSource = useCallback((id: string, patch: Partial<Source>) => {
    setScenes(current => current.map(scene => {
      if (scene.id !== activeSceneIdRef.current) return scene;
      return withLayout(scene, formatRef.current, layoutFor(scene, formatRef.current).map(source =>
        (source.id === id
          ? { ...source, ...patch, props: { ...source.props, ...(patch.props ?? {}) } }
          : source)));
    }));
  }, []);

  const removeSource = useCallback((id: string) => {
    setScenes(current => current.map(scene =>
      (scene.id === activeSceneIdRef.current
        ? withLayout(scene, formatRef.current,
          layoutFor(scene, formatRef.current).filter(source => source.id !== id))
        : scene)));
    setSelectedSourceId(previous => (previous === id ? null : previous));
  }, []);

  /*
   * Bass mode: listen to the chosen input and name the note being played.
   *
   * Forty times a second is fast enough to follow a moving line and slow enough
   * to cost nothing; the real latency is the analysis window, which has to hold
   * two periods of the lowest string. The window is set in time rather than in
   * samples so a 96 kHz interface does not halve it.
   */
  const [bassNote, setBassNote] = useState<TrackedNote | null>(null);
  const [bassPosition, setBassPosition] = useState<FretPosition | null>(null);
  const bassRef = useRef<{ note: TrackedNote | null; position: FretPosition | null }>({ note: null, position: null });

  useEffect(() => {
    if (settings.instrument !== 'bass') {
      bassRef.current = { note: null, position: null };
      setBassNote(null);
      setBassPosition(null);
      return;
    }
    const tracker = new NoteTracker(2, 3, settings.concertPitch);
    const tuning = BASS_TUNINGS[settings.bassTuning];
    let buffer = new Float32Array(new ArrayBuffer(4096 * 4));
    let lastPosition: FretPosition | null = null;

    const timer = window.setInterval(() => {
      const rate = audioEngine.context?.sampleRate ?? 48000;
      let wanted = 1024;
      while (wanted < rate * 0.085) wanted *= 2;
      if (buffer.length !== wanted) buffer = new Float32Array(new ArrayBuffer(wanted * 4));

      const heard = audioEngine.readChannelWaveform(settings.bassInputId, buffer);
      const factor = Math.max(1, Math.round(rate / 12000));
      const reading = heard ? detectPitch(decimate(buffer, factor), rate / factor) : null;
      const note = tracker.update(reading);

      const previous = bassRef.current.note;
      const changed = (note?.midi ?? -1) !== (previous?.midi ?? -1);
      // The tuning readout moves constantly; only a real change is worth a render.
      const drifted = note && previous && Math.abs(note.cents - previous.cents) >= 4;
      if (!changed && !drifted) return;

      let position = bassRef.current.position;
      if (changed) {
        position = note
          ? likelyPosition(positionsFor(note.midi, tuning, settings.bassFrets), lastPosition)
          : null;
        if (position) lastPosition = position;
        setBassPosition(position);
      }
      bassRef.current = { note, position };
      setBassNote(note);
    }, 25);

    return () => window.clearInterval(timer);
  }, [settings.instrument, settings.bassInputId, settings.bassTuning, settings.bassFrets, settings.concertPitch]);

  /*
   * Build the audio graph on the first click or key press.
   *
   * A browser will not start an AudioContext without a gesture, and building it
   * lazily on the first note costs tens of milliseconds exactly when timing
   * matters. Doing it on any early gesture means the first note is as prompt as
   * the hundredth.
   */
  useEffect(() => {
    const warm = () => { void audioEngine.resume(); };
    window.addEventListener('pointerdown', warm, { once: true });
    window.addEventListener('keydown', warm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', warm);
      window.removeEventListener('keydown', warm);
    };
  }, []);

  // Feed the compositor from refs rather than state, so it always paints the
  // current scene without the provider being rebuilt on every edit.
  const activeNotesRef = useRef(activeNotes);
  activeNotesRef.current = activeNotes;

  useEffect(() => {
    const images = new Map<string, CanvasImageSource>();

    /**
     * What the readouts say. In bass mode the chord readout names the note and
     * its degree instead, so a scene built for piano works for bass unchanged.
     */
    const bassContext = (chordSymbol?: string, chordNumeral?: string) => {
      const current = settingsRef.current;
      const key = { keyRoot: current.keyRoot, keyMode: current.mode };
      if (current.instrument !== 'bass') return { chordSymbol, chordNumeral, ...key };
      const { note, position } = bassRef.current;
      return {
        chordSymbol: note ? noteName(note.midi, current.accidental) : undefined,
        chordNumeral: note ? noteDegree(note.midi, current.keyRoot) : undefined,
        bass: {
          midi: note?.midi ?? null,
          position,
          tuning: current.bassTuning,
          keyRoot: current.keyRoot,
          frets: current.bassFrets,
        },
        ...key,
      };
    };
    sceneCompositor.setProvider(() => {
      const notes = activeNotesRef.current;
      const chord = detectChord(notes, settingsRef.current.accidental);
      const numeral = chord
        ? romanNumeral(chord, settingsRef.current.keyRoot, settingsRef.current.mode)
        : null;
      return {
        sources: layoutFor(activeSceneRef.current, formatRef.current),
        canvas: canvasSizeRef.current,
        context: {
          activeNotes: notes,
          accidental: settingsRef.current.accidental,
          ...bassContext(chord?.symbol, numeral ?? undefined),
          chordQuality: chord?.quality,
          images,
        },
      };
    });
    // The second shape paints the same scene from that format's own layout, so
    // a portrait cut is framed for portrait rather than cropped out of a wide
    // one. It shares the image cache, since both draw the same backdrops.
    secondaryCompositor.setProvider(() => {
      const notes = activeNotesRef.current;
      const chord = detectChord(notes, settingsRef.current.accidental);
      const numeral = chord
        ? romanNumeral(chord, settingsRef.current.keyRoot, settingsRef.current.mode)
        : null;
      const second = secondaryFormatRef.current;
      const spec = getFormat(second === 'off' ? 'portrait' : second);
      return {
        sources: layoutFor(activeSceneRef.current, (second === 'off' ? 'portrait' : second) as OutputFormatId),
        canvas: { width: spec.width, height: spec.height },
        context: {
          activeNotes: notes,
          accidental: settingsRef.current.accidental,
          ...bassContext(chord?.symbol, numeral ?? undefined),
          chordQuality: chord?.quality,
          images,
        },
      };
    });

    // Painting continuously keeps the canvas warm, so starting a recording
    // never captures a blank first frame.
    sceneCompositor.start(30);
    return () => {
      sceneCompositor.stop();
      secondaryCompositor.stop();
    };
  }, []);

  /** Only paint the second shape when one is actually chosen. */
  useEffect(() => {
    if (settings.secondaryFormat === 'off') {
      secondaryCompositor.stop();
      return;
    }
    const spec = getFormat(settings.secondaryFormat);
    secondaryCompositor.setOutputSize(renderSize(spec, getResolution(settings.resolution)));
    secondaryCompositor.start(30);
  }, [settings.secondaryFormat, settings.resolution]);

  // The compositor renders at the real output size, so a 4K choice produces 4K
  // pixels rather than an upscaled 1080p frame.
  useEffect(() => {
    const spec = getFormat(format);
    const resolution = getResolution(settings.resolution);
    sceneCompositor.setOutputSize(renderSize(spec, resolution));
  }, [format, settings.resolution]);

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
    // A single port, or every port when nothing is chosen.
    midiManager.setEnabledInputs(settings.midiInputId ? [settings.midiInputId] : undefined);
  }, [
    settingsLoaded, settings.concertPitch, settings.masterLevel, settings.monitorLevel,
    settings.limiter, settings.ducking, settings.duckingAmountDb, settings.midiEcho,
    settings.midiInputId,
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
    // The backing track and the metronome add their own strips when they are
    // first used, so the desk has to hear about it rather than only refreshing
    // when the mixer itself does something.
    return audioEngine.onChannelsChanged(syncChannels);
  }, [syncChannels]);

  const attachInput = useCallback(async (options: { id: string; label: string; deviceId?: string; isVoice?: boolean }) => {
    const state = await audioEngine.addInputChannel(options);
    syncChannels();
    if (state.error) setNotice(`${options.label}: ${state.error}`);
    // Remembered, so the bass is still on its input tomorrow. Only a device that
    // actually opened is worth remembering.
    else if (options.deviceId) {
      setSettings(current => ({
        ...current,
        inputDevices: { ...current.inputDevices, [options.id]: options.deviceId as string },
      }));
    }
    return state;
  }, [syncChannels]);

  const detachInput = useCallback((id: string) => {
    // Standard slots keep their strip on the desk; only the device is released.
    if (INPUT_SLOTS.some(slot => slot.id === id)) audioEngine.clearChannelDevice(id);
    else audioEngine.removeChannel(id);
    syncChannels();
    setSettings(current => {
      if (!(id in current.inputDevices)) return current;
      const { [id]: _removed, ...rest } = current.inputDevices;
      return { ...current, inputDevices: rest };
    });
  }, [syncChannels]);

  /*
   * Put every input back where it was last time.
   *
   * Without this a teacher re-picks their microphone and their bass on every
   * launch. It runs once, after the saved settings have arrived, and only for
   * devices that are still plugged in: a missing interface is left unassigned
   * rather than reported as an error on every start.
   */
  const inputsRestored = useRef(false);
  useEffect(() => {
    if (!settingsLoaded || inputsRestored.current) return;
    const wanted = Object.entries(settingsRef.current.inputDevices);
    if (!wanted.length) { inputsRestored.current = true; return; }
    // Device names are hidden until access is granted, but ids are not, and an
    // id is all that is needed to tell whether a device is still there.
    if (!catalog.audioInputs.length) return;
    inputsRestored.current = true;
    wanted.forEach(([slotId, deviceId]) => {
      const slot = INPUT_SLOTS.find(item => item.id === slotId);
      if (!slot || !catalog.audioInputs.some(device => device.id === deviceId)) return;
      void audioEngine.addInputChannel({
        id: slot.id, label: slot.label, deviceId, isVoice: slot.isVoice,
      }).then(syncChannels);
    });
  }, [settingsLoaded, catalog.audioInputs, syncChannels]);

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
        level: current.videoQuality as QualityLevel,
        frameRate: current.frameRate,
        recordAudio: current.recordAudio,
        recordMidi: current.recordMidi,
        // The other shape is captured alongside when one is switched on, so a
        // lesson filmed once yields both cuts.
        second: current.secondaryFormat === 'off'
          ? undefined
          : { label: current.secondaryFormat },
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
        // Report the real pixel size, so a 4K choice is visibly a 4K file.
        const size = result.width ? ` (${result.width}×${result.height})` : '';
        const both = result.secondPath
          ? ` Second shape saved too (${result.secondWidth}×${result.secondHeight}).`
          : '';
        setNotice((result.midiPath
          ? `Saved video${size} and MIDI to ${result.videoPath}`
          : `Saved${size} to ${result.videoPath}`) + both);
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
    format, setFormat, canvasSize, seedLayoutFrom,
    scenes, activeSceneId, activeScene, sources, reorderScene,
    selectScene, addScene, duplicateScene, renameScene, deleteScene,
    setSceneSources, saveProjectFile, openProjectFile, openProject, updateProject, projectDirty,
    bassNote, bassPosition,
    addSource, updateSource, removeSource, selectedSourceId, setSelectedSourceId,
    activeNotes, noteOn, noteOff, panic,
    recording, elapsedMs, startRecording, stopRecording,
    notice, setNotice,
  }), [
    settings, updateSettings, persistSettings, settingsLoaded,
    catalog, refresh, channels, levels, attachInput, detachInput,
    setChannelGain, setChannelMuted, setChannelSolo, setDuckingTrigger,
    format, setFormat, canvasSize, seedLayoutFrom,
    scenes, activeSceneId, activeScene, sources, reorderScene,
    selectScene, addScene, duplicateScene, renameScene, deleteScene,
    setSceneSources, saveProjectFile, openProjectFile, openProject, updateProject, projectDirty,
    bassNote, bassPosition,
    addSource, updateSource, removeSource, selectedSourceId,
    activeNotes, noteOn, noteOff, panic,
    recording, elapsedMs, startRecording, stopRecording, notice,
  ]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}
