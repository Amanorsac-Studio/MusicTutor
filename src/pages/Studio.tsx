import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines, BookOpen, Camera, Circle, Keyboard, Lock, Mic2, MonitorPlay,
  Music2, Pause, Piano, Plus, RotateCcw, Square, Video, Volume2,
} from 'lucide-react';
import { PianoKeyboard, KEY_RANGES } from '../components/PianoKeyboard';
import { ChordDisplay, KeySelector } from '../components/ChordDisplay';
import { DeviceSelect, Select } from '../components/Select';
import { Meter, Toggle, formatDb } from '../components/common';
import { useStudio } from '../lib/useStudio';
import { scaleNotes, type Mode } from '../lib/chords';
import { formatDuration } from '../lib/settings';
import { midiManager } from '../lib/midi';

type Scene = { name: string; subtitle: string; color: string; layout: number; camera: boolean; hands: boolean; keys: boolean };

const DEFAULT_SCENES: Scene[] = [
  { name: 'Default Lesson', subtitle: 'Face + Keys + Hands', color: '#178bff', layout: 0, camera: true, hands: true, keys: true },
  { name: 'Clean Blue', subtitle: 'Title + Hands', color: '#1568c9', layout: 1, camera: false, hands: true, keys: true },
  { name: 'Dark Studio', subtitle: 'Face + Keys', color: '#714825', layout: 0, camera: true, hands: false, keys: true },
  { name: 'Teaching Board', subtitle: 'Board + Face + VMK', color: '#386478', layout: 2, camera: true, hands: true, keys: true },
];

const BACKGROUNDS = ['studio', 'blue', 'wood', 'room', 'violet', 'mountain'];

export function Studio() {
  const {
    settings, updateSettings, catalog, activeNotes, noteOn, noteOff, panic, levels,
    channels, attachInput, detachInput,
    recording, elapsedMs, startRecording, stopRecording,
  } = useStudio();

  const [scenes, setScenes] = useState(DEFAULT_SCENES);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [cameraOn, setCameraOn] = useState(true);
  const [handsOn, setHandsOn] = useState(true);
  const [keysOn, setKeysOn] = useState(true);
  const [layout, setLayout] = useState(0);
  const [background, setBackground] = useState(0);
  const [title, setTitle] = useState("Today's Lesson");
  const [headline, setHeadline] = useState('Chord Progressions');
  const [subtitle, setSubtitle] = useState('I – IV – V in C Major');
  const [accent, setAccent] = useState('#1d9cff');
  const [cameraId, setCameraId] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [midiInputId, setMidiInputId] = useState('');

  const micChannel = channels.find(channel => channel.id === 'mic1');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cameraIds = catalog.videoInputs.map(device => device.id).join('|');
  const selectedCameraId = cameraId || catalog.videoInputs[0]?.id || '';

  // Live camera preview. Re-opens when the selection or device list changes.
  useEffect(() => {
    let cancelled = false;
    const stop = () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
    if (!cameraOn || !selectedCameraId) {
      stop();
      return;
    }
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: selectedCameraId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        stop();
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraError('');
      } catch (error) {
        if (!cancelled) setCameraError(error instanceof Error ? error.message : 'Camera unavailable');
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [cameraOn, selectedCameraId, cameraIds]);

  const applyScene = (index: number) => {
    const scene = scenes[index];
    if (!scene) return;
    setSceneIndex(index);
    setCameraOn(scene.camera);
    setHandsOn(scene.hands);
    setKeysOn(scene.keys);
    setLayout(scene.layout);
  };

  const applyLayout = (index: number) => {
    setLayout(index);
    if (index === 0) { setCameraOn(true); setHandsOn(true); setKeysOn(true); }
    else if (index === 1) { setCameraOn(false); setHandsOn(true); setKeysOn(true); }
    else { setCameraOn(true); setHandsOn(false); setKeysOn(true); }
  };

  const scaleHighlight = useMemo(
    () => (settings.highlightScale ? scaleNotes(settings.keyRoot, settings.mode) : undefined),
    [settings.highlightScale, settings.keyRoot, settings.mode],
  );

  const midiInputName = catalog.midiInputs[0]?.name;
  const midiStatusLabel = catalog.midi.state === 'ready' && midiInputName
    ? midiInputName
    : catalog.midi.state === 'denied'
      ? 'MIDI permission blocked'
      : catalog.midi.state === 'unsupported'
        ? 'Web MIDI unavailable'
        : 'Computer keyboard';

  return (
    <main className="studio-grid">
      <aside className="side left-panel">
        <div className="panel-heading io-heading"><span>Inputs &amp; outputs</span></div>
        <div className="quick-io">
          <label>
            <Camera size={17} />
            <span>Camera
              <DeviceSelect
                devices={catalog.videoInputs}
                value={selectedCameraId}
                onChange={setCameraId}
                label="Camera"
                emptyLabel="No cameras found"
              />
            </span>
          </label>
          <label>
            <Mic2 size={17} />
            <span>Audio input
              <DeviceSelect
                devices={catalog.audioInputs}
                value={micChannel?.deviceId ?? ''}
                onChange={value => {
                  if (!value) detachInput('mic1');
                  else void attachInput({ id: 'mic1', label: 'Mic 1', deviceId: value, isVoice: true });
                }}
                label="Audio input"
                emptyLabel="No microphones found"
                allowNone
                noneLabel="Not assigned"
              />
            </span>
          </label>
          <label>
            <Volume2 size={17} />
            <span>Audio output
              <DeviceSelect
                devices={catalog.audioOutputs}
                value={settings.outputDeviceId || catalog.audioOutputs[0]?.id || ''}
                onChange={value => updateSettings({ outputDeviceId: value })}
                label="Audio output"
                emptyLabel="Default output"
              />
            </span>
          </label>
          <label>
            <Keyboard size={17} />
            <span>MIDI input
              <Select
                label="MIDI input"
                value={midiInputId}
                onChange={value => {
                  setMidiInputId(value);
                  // An empty value means "listen to every connected port".
                  midiManager.setEnabledInputs(value ? [value] : undefined);
                }}
                options={[
                  { value: '', label: catalog.midiInputs.length ? 'All MIDI inputs' : midiStatusLabel },
                  ...catalog.midiInputs.map(port => ({ value: port.id, label: port.name })),
                ]}
              />
            </span>
          </label>
          <label>
            <Piano size={17} />
            <span>MIDI output
              <Select
                label="MIDI output"
                value={midiManager.selectedOutputId}
                onChange={value => midiManager.selectOutput(value)}
                options={[
                  { value: '', label: 'Built-in instrument' },
                  ...catalog.midiOutputs.map(port => ({ value: port.id, label: port.name })),
                ]}
              />
            </span>
          </label>
        </div>

        <hr />
        <div className="panel-heading">
          <span>Scenes</span>
          <button
            aria-label="Add scene"
            onClick={() => {
              setScenes(current => [...current, {
                name: `Custom Scene ${current.length + 1}`, subtitle: 'Editable layout',
                color: '#176a9e', layout: 0, camera: true, hands: true, keys: true,
              }]);
              setSceneIndex(scenes.length);
            }}
          ><Plus size={17} /></button>
        </div>
        <div className="scene-list">
          {scenes.map((scene, index) => (
            <div
              key={`${scene.name}-${index}`}
              role="button"
              tabIndex={0}
              className={`scene ${sceneIndex === index ? 'selected' : ''}`}
              onClick={() => applyScene(index)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') applyScene(index); }}
            >
              <span className="scene-thumb" style={{ background: `linear-gradient(140deg,${scene.color},#06101b)` }}>
                <MonitorPlay size={16} />
              </span>
              <span>
                <input
                  aria-label={`Scene ${index + 1} name`}
                  className="scene-name"
                  value={scene.name}
                  onClick={event => event.stopPropagation()}
                  onChange={event => setScenes(current =>
                    current.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))}
                />
                <small>{scene.subtitle}</small>
              </span>
              <button
                aria-label={`Delete ${scene.name}`}
                className="dots"
                onClick={event => {
                  event.stopPropagation();
                  if (scenes.length <= 1) return;
                  setScenes(current => current.filter((_, i) => i !== index));
                  setSceneIndex(0);
                }}
              >×</button>
            </div>
          ))}
        </div>

        <hr />
        <div className="panel-heading"><span>Sources</span></div>
        <div className="source-list">
          {([[Camera, 'Face camera', cameraOn, setCameraOn],
            [Video, 'Hands camera', handsOn, setHandsOn],
            [Piano, 'Virtual keyboard', keysOn, setKeysOn]] as const).map(([Icon, label, value, setValue]) => (
            <button
              key={label}
              className={`source ${value ? 'on' : 'off'}`}
              onClick={() => setValue(!value)}
              aria-pressed={value}
            >
              <Icon size={16} /><span>{label}</span>
              <Circle size={9} fill={value ? '#39dfa0' : '#3b4d60'} color={value ? '#39dfa0' : '#3b4d60'} />
            </button>
          ))}
          <button className="source locked" disabled><BookOpen size={16} /><span>Lesson title</span><Lock size={13} /></button>
        </div>

        <hr />
        <label className="section-label">Background</label>
        <div className="background-picks">
          {BACKGROUNDS.map((name, index) => (
            <button
              key={name}
              onClick={() => setBackground(index)}
              aria-label={`${name} background`}
              aria-pressed={background === index}
              className={background === index ? 'selected' : ''}
            ><span className={`bg-${name}`} /></button>
          ))}
        </div>
      </aside>

      <section className="studio-center">
        <div className="canvas-shell">
          <div className="canvas-topline">
            <span><Circle size={8} fill="#39dfa0" color="#39dfa0" /> LIVE PREVIEW</span>
            <span>1920 × 1080 · 30 FPS</span>
          </div>
          <div className={`composition bg-${BACKGROUNDS[background]} layout-${layout}`}>
            <div className="lesson-card"><span className="mark">▮▮▮▮</span><small>LEARN · PLAY · GROW</small></div>
            {cameraOn && (
              <div className="face-camera">
                <video ref={videoRef} muted playsInline />
                {(!selectedCameraId || cameraError) && (
                  <span className="camera-fallback"><Camera size={26} /><small>{cameraError || 'No camera connected'}</small></span>
                )}
              </div>
            )}
            <div className="lesson-copy">
              <span>{title}</span>
              <strong>{headline}</strong>
              <p>{subtitle}</p>
            </div>
            {keysOn && (
              <div className="vmk">
                <PianoKeyboard
                  active={activeNotes}
                  onNoteOn={noteOn}
                  onNoteOff={noteOff}
                  range={KEY_RANGES[settings.keyboardSize] ?? KEY_RANGES['61']}
                  accidental={settings.accidental}
                  accent={accent}
                  showAllLabels={settings.showAllLabels}
                  highlightPitchClasses={scaleHighlight}
                  computerKeys
                  computerKeyOctave={settings.computerKeyOctave}
                  compact
                />
                <ChordDisplay
                  notes={activeNotes}
                  accidental={settings.accidental}
                  keyRoot={settings.keyRoot}
                  mode={settings.mode}
                  compact
                />
              </div>
            )}
            {handsOn && (
              <div className="hands-camera">
                <img src="./assets/references/01_tutorial_reference_keyboard_title.jpeg" alt="Overhead keyboard view" />
              </div>
            )}
          </div>
        </div>

        <div className="transport">
          <div className="transport-meta">
            <span className={recording ? 'recording-dot' : ''}>
              <Circle size={9} fill="currentColor" /> {recording ? 'RECORDING' : 'READY'}
            </span>
            <b>{formatDuration(elapsedMs)}</b>
          </div>
          <div className="transport-controls">
            <button title="All notes off" aria-label="All notes off" onClick={panic}><RotateCcw size={17} /></button>
            <button
              className={`record ${recording ? 'active' : ''}`}
              onClick={() => (recording ? void stopRecording(headline.replace(/\s+/g, '_')) : void startRecording())}
              title={recording ? 'Stop recording' : 'Start recording'}
              aria-label={recording ? 'Stop recording' : 'Start recording'}
            >
              {recording ? <Square size={18} fill="white" /> : <Circle size={25} fill="currentColor" />}
            </button>
            <button title="Sustain" aria-label="Sustain" onClick={() => { /* reserved for pedal UI */ }}><Pause size={18} /></button>
          </div>
          <div className="health">
            <span className="transport-meter">
              <Volume2 size={13} />
              <Meter level={levels.master} label="Master output level" />
              <b>{formatDb(levels.master?.rms)}</b>
            </span>
            <span><Music2 size={13} /> {activeNotes.size} note{activeNotes.size === 1 ? '' : 's'}</span>
            <span><i /> {midiStatusLabel}</span>
          </div>
        </div>
      </section>

      <aside className="side right-panel">
        <div className="inspector-title"><span>Inspector</span></div>

        <label className="section-label">Layout</label>
        <div className="layout-picks">
          {['Face + Keys', 'Top Logo', 'Split View'].map((name, index) => (
            <button
              key={name}
              onClick={() => applyLayout(index)}
              className={layout === index ? 'selected' : ''}
              aria-pressed={layout === index}
            ><span className={`layout-icon l${index}`} /><small>{name}</small></button>
          ))}
        </div>

        <hr />
        <label className="section-label">Visible layers</label>
        <div className="settings-list">
          <span><Camera size={15} />Face camera<Toggle value={cameraOn} onChange={setCameraOn} label="Face camera" /></span>
          <span><Video size={15} />Hands camera<Toggle value={handsOn} onChange={setHandsOn} label="Hands camera" /></span>
          <span><Piano size={15} />Virtual keyboard<Toggle value={keysOn} onChange={setKeysOn} label="Virtual keyboard" /></span>
        </div>

        <hr />
        <label className="section-label">Lesson text</label>
        <input className="text-input" aria-label="Lesson label" value={title} onChange={event => setTitle(event.target.value)} />
        <input className="text-input" aria-label="Lesson headline" value={headline} onChange={event => setHeadline(event.target.value)} />
        <input className="text-input" aria-label="Lesson subtitle" value={subtitle} onChange={event => setSubtitle(event.target.value)} />

        <hr />
        <label className="section-label">Keyboard</label>
        <div className="field-row">
          <span>Size</span>
          <Select
            label="Keyboard size"
            value={settings.keyboardSize}
            onChange={value => updateSettings({ keyboardSize: value as typeof settings.keyboardSize })}
            options={Object.keys(KEY_RANGES).map(size => ({ value: size, label: `${size} keys` }))}
          />
        </div>
        <div className="field-row">
          <span>Note names</span>
          <Select
            label="Accidental spelling"
            value={settings.accidental}
            onChange={value => updateSettings({ accidental: value as 'sharp' | 'flat' })}
            options={[{ value: 'sharp', label: 'Sharps (C#)' }, { value: 'flat', label: 'Flats (Db)' }]}
          />
        </div>
        <div className="settings-list">
          <span><Keyboard size={15} />Label every key
            <Toggle value={settings.showAllLabels} onChange={value => updateSettings({ showAllLabels: value })} label="Label every key" />
          </span>
          <span><Music2 size={15} />Highlight key notes
            <Toggle value={settings.highlightScale} onChange={value => updateSettings({ highlightScale: value })} label="Highlight key notes" />
          </span>
        </div>

        <hr />
        <label className="section-label">Chord analysis</label>
        <KeySelector
          keyRoot={settings.keyRoot}
          mode={settings.mode}
          onKeyRoot={value => updateSettings({ keyRoot: value })}
          onMode={(value: Mode) => updateSettings({ mode: value })}
        />
        <ChordDisplay notes={activeNotes} accidental={settings.accidental} keyRoot={settings.keyRoot} mode={settings.mode} />

        <hr />
        <label className="section-label">Keyboard highlight</label>
        <div className="color-picks">
          {['#ffffff', '#1d9cff', '#7746e9', '#39b77b', '#ffb12b', '#ff4c55'].map(color => (
            <button
              key={color}
              aria-label={`Highlight ${color}`}
              aria-pressed={accent === color}
              onClick={() => setAccent(color)}
              className={accent === color ? 'selected' : ''}
              style={{ background: color }}
            />
          ))}
        </div>

        <hr />
        <label className="section-label">Recording</label>
        <div className="settings-list">
          <span><AudioLines size={15} />Record audio
            <Toggle value={settings.recordAudio} onChange={value => updateSettings({ recordAudio: value })} label="Record audio" />
          </span>
          <span><Keyboard size={15} />Record MIDI
            <Toggle value={settings.recordMidi} onChange={value => updateSettings({ recordMidi: value })} label="Record MIDI" />
          </span>
        </div>
        <button
          className="primary-action"
          onClick={() => (recording ? void stopRecording(headline.replace(/\s+/g, '_')) : void startRecording())}
        >
          {recording ? <Square size={16} fill="white" /> : <Circle size={16} fill="#ff4c55" color="#ff4c55" />}
          {recording ? 'Stop recording' : 'Start recording'}
        </button>
      </aside>
    </main>
  );
}
