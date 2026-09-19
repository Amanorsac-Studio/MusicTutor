import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, AudioLines, Camera, Guitar, ChevronsDown, ChevronsUp, Circle, Copy, Eye, EyeOff,
  Image as ImageIcon, Keyboard, Lock, Maximize, Mic2, Move, Music2, Piano, Plus,
  Radio, RotateCcw, Square, Trash2, Type, Unlock, Video, Volume2,
} from 'lucide-react';
import { SceneCanvas } from '../components/SceneCanvas';
import { TrackPanel } from '../components/TrackPanel';
import { SecondShapePreview } from '../components/SecondShapePreview';
import { DeviceSelect, Select } from '../components/Select';
import { Meter, formatDb } from '../components/common';
import { useStudio } from '../lib/useStudio';
import { detectChord, romanNumeral } from '../lib/chords';
import { formatDuration } from '../lib/settings';
import {
  cameraRoleRect, centreRect, countSources, createCameraSource, fillCanvas, fitToCanvas,
  layoutFor, naturalKeyboardHeight, reorder,
  type CameraRole, type ChordDisplayMode, type Source, type SourceKind,
} from '../lib/scene';
import { FORMAT_IDS, OUTPUT_FORMATS, getFormat, type OutputFormatId } from '../lib/formats';
import { KEY_NAMES, noteName, scaleNotes, type Mode } from '../lib/chords';
import { noteDegree } from '../lib/fretboard';
import { INPUT_SLOTS } from '../lib/inputs';
import { BACKDROPS } from '../lib/backdrops';
import { midiManager } from '../lib/midi';
import { cameraHub } from '../lib/cameraHub';
import { liveStreamer } from '../lib/liveStream';
import { loadDestinations, validateAll, EMPTY_STATUS, type StreamStatus } from '../lib/streaming';
import { type QualityLevel } from '../lib/formats';

type MenuEntry = { key: string; label: string; Icon: typeof Camera; kind: SourceKind; role?: CameraRole };

const SOURCE_KINDS: MenuEntry[] = [
  { key: 'backdrop', label: 'Backdrop', kind: 'backdrop', Icon: ImageIcon },
  { key: 'camera-face', label: 'Face camera', kind: 'camera', role: 'face', Icon: Camera },
  { key: 'camera-hand', label: 'Hand camera', kind: 'camera', role: 'hand', Icon: Video },
  { key: 'keyboard', label: 'Piano keyboard', kind: 'keyboard', Icon: Piano },
  { key: 'text', label: 'Text', kind: 'text', Icon: Type },
  { key: 'chord', label: 'Chord readout', kind: 'chord', Icon: Music2 },
  { key: 'staff', label: 'Notation staff', kind: 'staff', Icon: AudioLines },
  { key: 'fretboard', label: 'Bass fretboard', kind: 'fretboard', Icon: Guitar },
  { key: 'image', label: 'Image', kind: 'image', Icon: ImageIcon },
  { key: 'color', label: 'Colour block', kind: 'color', Icon: Square },
];

export function Studio({ onOpenStream }: { onOpenStream?: () => void } = {}) {
  const {
    settings, updateSettings, catalog, activeNotes, noteOn, noteOff, panic, levels,
    channels, attachInput, detachInput,
    recording, elapsedMs, startRecording, stopRecording,
    scenes, activeScene, activeSceneId, sources, selectScene, addScene, duplicateScene,
    renameScene, deleteScene, reorderScene, setSceneSources, addSource, updateSource, removeSource,
    selectedSourceId, setSelectedSourceId,
    format, setFormat, canvasSize, seedLayoutFrom, setNotice, bassNote,
  } = useStudio();

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [viewZoom, setViewZoom] = useState(1);
  /** Which half of the right column is showing while a source is selected. */
  const [rightTab, setRightTab] = useState<'source' | 'track'>('source');

  const micChannel = channels.find(channel => channel.id === 'mic1');
  const selected = sources.find(source => source.id === selectedSourceId) ?? null;

  const chord = useMemo(
    () => detectChord(activeNotes, settings.accidental),
    [activeNotes, settings.accidental],
  );
  const numeral = chord ? romanNumeral(chord, settings.keyRoot, settings.mode) : null;

  const midiStatusLabel = catalog.midi.state === 'denied'
    ? 'MIDI permission blocked'
    : catalog.midi.state === 'unsupported'
      ? 'Web MIDI unavailable'
      : catalog.midiInputs.length ? 'All MIDI inputs' : 'Computer keyboard';

  const layerAction = (direction: 'up' | 'down' | 'top' | 'bottom') => {
    if (!selected || !activeScene) return;
    setSceneSources(reorder(sources, selected.id, direction));
  };

  const addMenuEntry = (entry: MenuEntry) => {
    setAddMenuOpen(false);

    if (entry.kind === 'camera' && entry.role) {
      // Prefer the camera already assigned to this role on the Devices page.
      const assigned = entry.role === 'hand' ? settings.handCameraId : settings.faceCameraId;
      const used = new Set(sources.filter(s => s.kind === 'camera').map(s => s.props.deviceId));
      const fallback = catalog.videoInputs.find(device => !used.has(device.id)) ?? catalog.videoInputs[0];
      const deviceId = assigned || fallback?.id;
      const template = createCameraSource(entry.role, deviceId, entry.label, canvasSize);
      addSource('camera', {
        name: template.name,
        x: template.x, y: template.y, width: template.width, height: template.height,
        props: template.props,
      });
      return;
    }

    // Backdrops are placed at the back of the stack by addSource itself.
    addSource(entry.kind);
  };

  return (
    <main className="studio-grid">
      {/* ---------------------------------------------------------- left */}
      <aside className="side left-panel">
        <div className="panel-heading io-heading"><span>Inputs &amp; outputs</span></div>
        <div className="quick-io">
          <label>
            <Mic2 size={16} />
            <span>Microphone
              <DeviceSelect
                devices={catalog.audioInputs}
                value={micChannel?.deviceId ?? ''}
                onChange={value => {
                  if (!value) detachInput('mic1');
                  else void attachInput({ id: 'mic1', label: 'Mic 1', deviceId: value, isVoice: true });
                }}
                label="Microphone"
                emptyLabel="No microphones found"
                allowNone
                noneLabel="Not assigned"
              />
            </span>
          </label>
          <label>
            <Volume2 size={16} />
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
            <Keyboard size={16} />
            <span>MIDI input
              <Select
                label="MIDI input"
                value={settings.midiInputId}
                onChange={value => updateSettings({ midiInputId: value })}
                options={[
                  { value: '', label: midiStatusLabel },
                  ...catalog.midiInputs.map(port => ({ value: port.id, label: port.name })),
                ]}
              />
            </span>
          </label>
          <label>
            <Piano size={16} />
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

        {/* Scenes */}
        <div className="panel-heading">
          <span>Scenes</span>
          <button aria-label="Add scene" onClick={() => addScene()}><Plus size={16} /></button>
        </div>
        <div className="scene-list">
          {scenes.map((scene, index) => (
            <div
              key={scene.id}
              className={`scene-row ${scene.id === activeSceneId ? 'selected' : ''}`}
              onClick={() => selectScene(scene.id)}
              role="button"
              tabIndex={0}
              onKeyDown={event => { if (event.key === 'Enter') selectScene(scene.id); }}
            >
              <input
                aria-label={`Scene name: ${scene.name}`}
                value={scene.name}
                onClick={event => event.stopPropagation()}
                onChange={event => renameScene(scene.id, event.target.value)}
              />
              <small>{layoutFor(scene, format).length} source{layoutFor(scene, format).length === 1 ? '' : 's'} · {countSources(scene)} total</small>
              <span className="scene-row-actions">
                <button
                  aria-label={`Move ${scene.name} up`}
                  disabled={index === 0}
                  onClick={event => { event.stopPropagation(); reorderScene(scene.id, 'up'); }}
                ><ArrowUp size={13} /></button>
                <button
                  aria-label={`Move ${scene.name} down`}
                  disabled={index === scenes.length - 1}
                  onClick={event => { event.stopPropagation(); reorderScene(scene.id, 'down'); }}
                ><ArrowDown size={13} /></button>
                <button
                  aria-label={`Duplicate ${scene.name}`}
                  onClick={event => { event.stopPropagation(); duplicateScene(scene.id); }}
                ><Copy size={13} /></button>
                <button
                  aria-label={`Delete ${scene.name}`}
                  onClick={event => { event.stopPropagation(); deleteScene(scene.id); }}
                ><Trash2 size={13} /></button>
              </span>
            </div>
          ))}
          {!scenes.length && <p className="panel-hint">Create a scene to begin.</p>}
        </div>

        <hr />

        {/* Sources (layers) */}
        <div className="panel-heading">
          <span>Sources</span>
          <button
            aria-label="Add source"
            disabled={!activeScene}
            onClick={() => setAddMenuOpen(open => !open)}
          ><Plus size={16} /></button>
        </div>
        {addMenuOpen && (
          <div className="add-source-menu">
            {SOURCE_KINDS.map(entry => (
              <button key={entry.key} onClick={() => addMenuEntry(entry)}>
                <entry.Icon size={14} />{entry.label}
              </button>
            ))}
          </div>
        )}
        <div className="source-layers">
          {/* Topmost layer first, the way a layer list reads. */}
          {[...sources].reverse().map(source => (
            <div
              key={source.id}
              className={`layer-row ${source.id === selectedSourceId ? 'selected' : ''}`}
              onClick={() => setSelectedSourceId(source.id)}
              role="button"
              tabIndex={0}
              onKeyDown={event => { if (event.key === 'Enter') setSelectedSourceId(source.id); }}
            >
              <button
                className="layer-toggle"
                aria-label={`${source.visible ? 'Hide' : 'Show'} ${source.name}`}
                aria-pressed={source.visible}
                onClick={event => { event.stopPropagation(); updateSource(source.id, { visible: !source.visible }); }}
              >{source.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
              <span className="layer-name">{source.name}</span>
              <button
                className="layer-toggle"
                aria-label={`${source.locked ? 'Unlock' : 'Lock'} ${source.name}`}
                aria-pressed={source.locked}
                onClick={event => { event.stopPropagation(); updateSource(source.id, { locked: !source.locked }); }}
              >{source.locked ? <Lock size={13} /> : <Unlock size={13} />}</button>
            </div>
          ))}
          {activeScene && !sources.length && (
            <>
              <p className="panel-hint">
                No sources in the {getFormat(format).short.toLowerCase()} layout yet.
                Use + to add a camera, the keyboard, or text.
              </p>
              {FORMAT_IDS.filter(id => id !== format && layoutFor(activeScene, id).length > 0).map(id => (
                <button key={id} className="subtle-btn" onClick={() => seedLayoutFrom(id)}>
                  <Copy size={13} />Start from the {OUTPUT_FORMATS[id].short.toLowerCase()} layout
                </button>
              ))}
            </>
          )}
        </div>
      </aside>

      {/* -------------------------------------------------------- centre */}
      <section className="studio-center">
        <div
          className="canvas-shell"
          /*
           * Clicking the space around the canvas clears the selection. Clicking
           * the canvas itself already does, but the margin around it looked
           * like empty space and did nothing, which made a selection feel stuck.
           * Controls in the top line are excluded, or picking a format would
           * also deselect.
           */
          onPointerDown={event => {
            const target = event.target as HTMLElement;
            if (target.closest('button, input, select, .scene-canvas')) return;
            setSelectedSourceId(null);
          }}
        >
          <div className="canvas-topline">
            <span>
              <Circle size={8} fill={recording ? '#ff4c55' : '#39dfa0'} color={recording ? '#ff4c55' : '#39dfa0'} />
              {recording ? ' RECORDING' : ' LIVE PREVIEW'}
            </span>

            {/* Each format keeps its own arrangement, so switching here changes
                which layout you are editing, not the sources themselves. */}
            <span className="format-switch" role="group" aria-label="Output format">
              {FORMAT_IDS.map(id => (
                <button
                  key={id}
                  className={format === id ? 'active' : ''}
                  aria-pressed={format === id}
                  title={OUTPUT_FORMATS[id].label}
                  onClick={() => setFormat(id)}
                >{OUTPUT_FORMATS[id].short} {OUTPUT_FORMATS[id].aspect}</button>
              ))}
            </span>

            {/*
              * The second shape. A lesson is often wanted wide and tall at
              * once, and each is framed from its own layout rather than
              * cropped out of the other.
              */}
            <span className="format-switch second" role="group" aria-label="Second shape">
              <small>+</small>
              <button
                className={settings.secondaryFormat === 'off' ? 'active' : ''}
                aria-pressed={settings.secondaryFormat === 'off'}
                title="Compose one shape only"
                onClick={() => updateSettings({ secondaryFormat: 'off' })}
              >Off</button>
              {FORMAT_IDS.filter(id => id !== format).map(id => (
                <button
                  key={id}
                  className={settings.secondaryFormat === id ? 'active' : ''}
                  aria-pressed={settings.secondaryFormat === id}
                  title={`Also compose ${OUTPUT_FORMATS[id].label}`}
                  onClick={() => updateSettings({ secondaryFormat: id })}
                >{OUTPUT_FORMATS[id].short}</button>
              ))}
            </span>

            <span className="canvas-zoom">
              <button aria-label="Zoom out" onClick={() => setViewZoom(z => Math.max(0.4, z - 0.2))}>−</button>
              <b>{Math.round(viewZoom * 100)}%</b>
              <button aria-label="Zoom in" onClick={() => setViewZoom(z => Math.min(3, z + 0.2))}>+</button>
              <button aria-label="Reset zoom" onClick={() => setViewZoom(1)}>Fit</button>
            </span>

            <span>{canvasSize.width} × {canvasSize.height}</span>
          </div>

          {activeScene ? (
            <SceneCanvas
              sources={sources}
              canvas={canvasSize}
              viewZoom={viewZoom}
              selectedId={selectedSourceId}
              onSelect={setSelectedSourceId}
              onChange={setSceneSources}
              activeNotes={activeNotes}
              onNoteOn={noteOn}
              onNoteOff={noteOff}
              accidental={settings.accidental}
              chordSymbol={chord?.symbol}
              chordNumeral={numeral ?? undefined}
            />
          ) : (
            <div className="scene-canvas"><div className="scene-empty"><b>No scene selected</b></div></div>
          )}

          {settings.secondaryFormat !== 'off' && (
            <SecondShapePreview format={settings.secondaryFormat} />
          )}
        </div>

        {/* The key you are playing in, right under the picture, because chord
            numbers are meaningless without it and it changes song to song. */}
        <div className="key-bar">
          {/*
            * What the lesson is about. It decides what is listened to: keys and
            * MIDI for piano, a single line from an audio input for bass.
            */}
          <div className="key-mode instrument-switch" role="group" aria-label="Instrument">
            {(['piano', 'bass'] as const).map(instrument => (
              <button
                key={instrument}
                className={settings.instrument === instrument ? 'active' : ''}
                aria-pressed={settings.instrument === instrument}
                onClick={() => updateSettings({ instrument })}
              >{instrument}</button>
            ))}
          </div>
          <span className="key-bar-label">Key</span>
          <div className="key-chips" role="group" aria-label="Key">
            {KEY_NAMES.map((name, index) => (
              <button
                key={name}
                className={settings.keyRoot === index ? 'active' : ''}
                aria-pressed={settings.keyRoot === index}
                onClick={() => updateSettings({ keyRoot: index })}
              >{name}</button>
            ))}
          </div>
          <div className="key-mode" role="group" aria-label="Mode">
            {(['major', 'minor'] as Mode[]).map(mode => (
              <button
                key={mode}
                className={settings.mode === mode ? 'active' : ''}
                aria-pressed={settings.mode === mode}
                onClick={() => updateSettings({ mode })}
              >{mode}</button>
            ))}
          </div>
          <span className="key-scale" aria-label="Notes in this key">
            {scaleNotes(settings.keyRoot, settings.mode).map(pc => KEY_NAMES[pc]).join(' ')}
          </span>
          {settings.instrument === 'bass' ? (
            <span className="key-now">
              {bassNote ? (
                <>
                  <b>{noteName(bassNote.midi, settings.accidental)}</b>
                  <i>{noteDegree(bassNote.midi, settings.keyRoot)}</i>
                  <small className="cents">
                    {bassNote.cents === 0 ? 'in tune' : `${bassNote.cents > 0 ? '+' : ''}${bassNote.cents}¢`}
                  </small>
                </>
              ) : <small>Play a note</small>}
            </span>
          ) : (
            <span className="key-now">
              {chord ? <><b>{chord.symbol}</b>{numeral && <i>{numeral}</i>}</> : <small>Play to analyse</small>}
            </span>
          )}
        </div>

        {settings.instrument === 'bass' && (
          <div className="key-bar bass-bar">
            <span className="key-bar-label">Bass in</span>
            <div className="key-mode" role="group" aria-label="Bass input">
              {INPUT_SLOTS.map(slot => {
                const channel = channels.find(item => item.id === slot.id);
                return (
                  <button
                    key={slot.id}
                    className={settings.bassInputId === slot.id ? 'active' : ''}
                    aria-pressed={settings.bassInputId === slot.id}
                    title={channel?.connected ? channel.trackLabel ?? slot.label : 'No device on this input yet'}
                    onClick={() => updateSettings({ bassInputId: slot.id })}
                  >{slot.label}</button>
                );
              })}
            </div>
            <div className="key-mode" role="group" aria-label="Strings">
              {(['four', 'five'] as const).map(tuning => (
                <button
                  key={tuning}
                  className={settings.bassTuning === tuning ? 'active' : ''}
                  aria-pressed={settings.bassTuning === tuning}
                  onClick={() => updateSettings({ bassTuning: tuning })}
                >{tuning === 'four' ? '4-string' : '5-string'}</button>
              ))}
            </div>
            <span className="key-scale">
              {channels.find(item => item.id === settings.bassInputId)?.connected
                ? 'Listening. Add a Bass fretboard source to show the neck in the video.'
                : 'Assign your bass or interface to this input on the Devices tab.'}
            </span>
          </div>
        )}

        <div className="transport">
          <div className="transport-meta">
            <span className={recording ? 'recording-dot' : ''}>
              <Circle size={9} fill="currentColor" /> {recording ? 'RECORDING' : 'READY'}
            </span>
            <b>{formatDuration(elapsedMs)}</b>
          </div>
          <div className="transport-controls">
            <button title="All notes off" aria-label="All notes off" onClick={panic}><RotateCcw size={17} /></button>
            <GoLiveButton
              frameRate={settings.frameRate}
              quality={settings.videoQuality as QualityLevel}
              onNotice={setNotice}
              onOpenStream={onOpenStream}
            />
            <button
              className={`record ${recording ? 'active' : ''}`}
              onClick={() => (recording
                ? void stopRecording((activeScene?.name ?? 'Lesson').replace(/\s+/g, '_'))
                : void startRecording())}
              aria-label={recording ? 'Stop recording' : 'Start recording'}
            >
              {recording ? <Square size={18} fill="white" /> : <Circle size={25} fill="currentColor" />}
            </button>
          </div>
          <div className="health">
            <span className="transport-meter">
              <Volume2 size={13} />
              <Meter level={levels.master} label="Master output level" />
              <b>{formatDb(levels.master?.rms)}</b>
            </span>
            <span><Music2 size={13} /> {activeNotes.size} note{activeNotes.size === 1 ? '' : 's'}</span>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- right */}
      <aside className="side right-panel">
        {/*
          * With nothing selected the column is the backing-track player, so it
          * is useful through the whole lesson. With something selected both are
          * wanted: adjusting a camera while the track plays is normal, and
          * hiding the transport to show a colour picker is not.
          */}
        {selected ? (
          <>
            <div className="panel-tabs">
              <button
                className={rightTab === 'source' ? 'active' : ''}
                aria-pressed={rightTab === 'source'}
                onClick={() => setRightTab('source')}
              >Source</button>
              <button
                className={rightTab === 'track' ? 'active' : ''}
                aria-pressed={rightTab === 'track'}
                onClick={() => setRightTab('track')}
              >Backing track</button>
            </div>
            {rightTab === 'source' ? (
              <SourceInspector
                source={selected}
                cameras={catalog.videoInputs}
                canvas={canvasSize}
                onChange={patch => updateSource(selected.id, patch)}
                onRemove={() => removeSource(selected.id)}
                onLayer={layerAction}
              />
            ) : (
              <TrackPanel />
            )}
          </>
        ) : (
          <TrackPanel />
        )}
      </aside>
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * Inspector
 * ------------------------------------------------------------------ */

/** Push in on a picture and slide the visible window around. */
function ZoomControls({
  source, onProp,
}: {
  source: Source;
  onProp: <K extends keyof Source['props']>(key: K, value: Source['props'][K]) => void;
}) {
  const zoom = source.props.zoom ?? 1;
  return (
    <>
      <label className="inspector-field wide">
        <span>Zoom {zoom.toFixed(1)}×</span>
        <input
          type="range" min={100} max={400}
          aria-label="Zoom"
          value={Math.round(zoom * 100)}
          onChange={event => onProp('zoom', Number(event.target.value) / 100)}
        />
      </label>
      {zoom > 1 && (
        <div className="inspector-grid">
          <label className="inspector-field">
            <span>Pan X</span>
            <input
              type="range" min={-100} max={100}
              aria-label="Pan horizontally"
              value={Math.round((source.props.panX ?? 0) * 100)}
              onChange={event => onProp('panX', Number(event.target.value) / 100)}
            />
          </label>
          <label className="inspector-field">
            <span>Pan Y</span>
            <input
              type="range" min={-100} max={100}
              aria-label="Pan vertically"
              value={Math.round((source.props.panY ?? 0) * 100)}
              onChange={event => onProp('panY', Number(event.target.value) / 100)}
            />
          </label>
        </div>
      )}
    </>
  );
}

function SourceInspector({
  source, cameras, canvas, onChange, onRemove, onLayer,
}: {
  source: Source;
  cameras: Array<{ id: string; name: string }>;
  canvas: { width: number; height: number };
  onChange: (patch: Partial<Source>) => void;
  onRemove: () => void;
  onLayer: (direction: 'up' | 'down' | 'top' | 'bottom') => void;
}) {
  const number = (label: string, key: 'x' | 'y' | 'width' | 'height') => (
    <label className="inspector-field">
      <span>{label}</span>
      <input
        type="number"
        aria-label={`${source.name} ${label}`}
        value={Math.round(source[key])}
        onChange={event => onChange({ [key]: Number(event.target.value) } as Partial<Source>)}
      />
    </label>
  );

  const prop = <K extends keyof Source['props']>(key: K, value: Source['props'][K]) =>
    onChange({ props: { [key]: value } as Source['props'] });

  return (
    <div className="inspector">
      <label className="inspector-field wide">
        <span>Name</span>
        <input
          aria-label="Source name"
          value={source.name}
          onChange={event => onChange({ name: event.target.value })}
        />
      </label>

      <label className="section-label">Position &amp; size</label>
      <div className="inspector-grid">
        {number('X', 'x')}
        {number('Y', 'y')}
        {number('W', 'width')}
        {number('H', 'height')}
      </div>
      <div className="inspector-buttons">
        <button onClick={() => onChange(fillCanvas(canvas))}><Maximize size={13} />Fill screen</button>
        <button onClick={() => onChange(centreRect(source, canvas))}><Move size={13} />Centre</button>
        <button onClick={() => onChange(fitToCanvas(source.width / source.height, canvas))}>Fit</button>
      </div>

      <label className="section-label">Layer order</label>
      <div className="inspector-buttons">
        <button aria-label="Bring to front" onClick={() => onLayer('top')}><ChevronsUp size={13} /></button>
        <button aria-label="Bring forward" onClick={() => onLayer('up')}><ArrowUp size={13} /></button>
        <button aria-label="Send backward" onClick={() => onLayer('down')}><ArrowDown size={13} /></button>
        <button aria-label="Send to back" onClick={() => onLayer('bottom')}><ChevronsDown size={13} /></button>
      </div>

      <label className="inspector-field wide">
        <span>Opacity {Math.round(source.opacity * 100)}%</span>
        <input
          type="range" min={0} max={100}
          aria-label="Opacity"
          value={Math.round(source.opacity * 100)}
          onChange={event => onChange({ opacity: Number(event.target.value) / 100 })}
        />
      </label>

      <hr />

      {source.kind === 'backdrop' && (
        <>
          <label className="section-label">Backdrop</label>
          <div className="backdrop-picks">
            {BACKDROPS.map(backdrop => (
              <button
                key={backdrop.id}
                aria-label={backdrop.name}
                title={backdrop.name}
                aria-pressed={(source.props.backdrop ?? 'studio') === backdrop.id}
                className={(source.props.backdrop ?? 'studio') === backdrop.id ? 'selected' : ''}
                style={{ background: backdrop.css }}
                onClick={() => prop('backdrop', backdrop.id)}
              />
            ))}
          </div>
          <small className="field-hint">
            Backdrops sit behind every other source. Use an Image source instead to
            use your own picture.
          </small>
        </>
      )}

      {source.kind === 'camera' && (
        <>
          <label className="section-label">Camera</label>
          <div className="inspector-field wide">
            <span>Role</span>
            <Select
              label="Camera role"
              value={source.props.role ?? 'face'}
              onChange={value => {
                const role = value as CameraRole;
                // Switching role reshapes the frame to that shot's proportions.
                onChange({ props: { role }, ...cameraRoleRect(role, canvas) });
              }}
              options={[
                { value: 'face', label: 'Face camera (16:9)' },
                { value: 'hand', label: 'Hand camera (wide strip)' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </div>
          <DeviceSelect
            devices={cameras}
            value={source.props.deviceId ?? ''}
            onChange={value => prop('deviceId', value)}
            label="Camera device"
            emptyLabel="No cameras found"
          />
          <div className="inspector-field wide">
            <span>Fill mode</span>
            <Select
              label="Camera fill mode"
              value={source.props.fit ?? 'cover'}
              onChange={value => prop('fit', value as 'cover' | 'contain' | 'stretch')}
              options={[
                { value: 'cover', label: 'Crop to fill' },
                { value: 'contain', label: 'Fit inside' },
                { value: 'stretch', label: 'Stretch' },
              ]}
            />
          </div>
          <label className="inspector-check">
            <input
              type="checkbox"
              checked={Boolean(source.props.mirror)}
              onChange={event => prop('mirror', event.target.checked)}
            />
            Mirror horizontally
          </label>
          <ZoomControls source={source} onProp={prop} />
        </>
      )}

      {source.kind === 'keyboard' && (
        <>
          <label className="section-label">Keyboard</label>
          <div className="inspector-field wide">
            <span>Range</span>
            <Select
              label="Keyboard range"
              value={`${source.props.firstNote ?? 21}-${source.props.lastNote ?? 108}`}
              onChange={value => {
                const [first, last] = value.split('-').map(Number);
                // Fewer keys means wider keys, so the height follows the range.
                onChange({
                  props: { firstNote: first, lastNote: last },
                  height: naturalKeyboardHeight(source.width, first, last, source.props.namePlayed !== false),
                });
              }}
              options={[
                { value: '21-108', label: '88 keys · A0 – C8' },
                { value: '28-103', label: '76 keys · E1 – G7' },
                { value: '36-96', label: '61 keys · C2 – C7' },
                { value: '36-84', label: '49 keys · C2 – C6' },
                { value: '48-84', label: '37 keys · C3 – C6' },
                { value: '48-72', label: '25 keys · C3 – C5' },
              ]}
            />
          </div>
          <div className="inspector-field wide">
            <span>Key labels</span>
            <Select
              label="Key labels"
              value={source.props.showLabels ?? 'c-only'}
              onChange={value => prop('showLabels', value as 'none' | 'c-only' | 'all')}
              options={[
                { value: 'none', label: 'None' },
                { value: 'c-only', label: 'C notes only' },
                { value: 'all', label: 'Every key' },
              ]}
            />
          </div>
          <label className="inspector-field wide">
            <span>Highlight colour</span>
            <input
              type="color"
              aria-label="Highlight colour"
              value={source.props.accent ?? '#ffa629'}
              onChange={event => prop('accent', event.target.value)}
            />
          </label>
          <label className="inspector-check">
            <input
              type="checkbox"
              checked={source.props.namePlayed !== false}
              onChange={event => prop('namePlayed', event.target.checked)}
            />
            Name the notes being played
          </label>
          <div className="inspector-buttons">
            <button
              onClick={() => onChange({
                height: naturalKeyboardHeight(
                  source.width,
                  source.props.firstNote ?? 21,
                  source.props.lastNote ?? 108,
                  source.props.namePlayed !== false,
                ),
              })}
            >Natural key shape</button>
          </div>
          <small className="field-hint">
            Sets the height so the keys keep a real instrument's proportions, which is
            what stops a long keyboard looking like a row of slivers.
          </small>
        </>
      )}

      {source.kind === 'fretboard' && (
        <>
          <label className="section-label">Bass fretboard</label>
          <label className="inspector-field wide">
            <span>Marker colour</span>
            <input
              type="color"
              aria-label="Marker colour"
              value={source.props.accent ?? '#ffa629'}
              onChange={event => prop('accent', event.target.value)}
            />
          </label>
          <div className="inspector-field wide">
            <span>Background</span>
            <Select
              label="Fretboard background"
              value={source.props.background === 'transparent' ? 'transparent' : 'panel'}
              onChange={value => prop('background', value === 'transparent' ? 'transparent' : 'rgba(6,16,26,0.78)')}
              options={[
                { value: 'panel', label: 'Dark panel' },
                { value: 'transparent', label: 'Transparent' },
              ]}
            />
          </div>
          <label className="inspector-check">
            <input
              type="checkbox"
              checked={source.props.namePlayed !== false}
              onChange={event => prop('namePlayed', event.target.checked)}
            />
            Show the note name and its degree
          </label>
          <small className="field-hint">
            Shows the note the bass is playing, in the key set under the picture. Every
            place it can be played is ringed, and the likeliest is filled. Switch the
            instrument to bass for it to listen.
          </small>
        </>
      )}

      {source.kind === 'staff' && (
        <>
          <label className="section-label">Notation staff</label>
          <label className="inspector-field wide">
            <span>Notehead colour</span>
            <input
              type="color"
              aria-label="Notehead colour"
              value={source.props.accent ?? '#ffa629'}
              onChange={event => prop('accent', event.target.value)}
            />
          </label>
          <label className="inspector-field wide">
            <span>Staff colour</span>
            <input
              type="color"
              aria-label="Staff colour"
              value={source.props.color ?? '#0d1420'}
              onChange={event => prop('color', event.target.value)}
            />
          </label>
          <div className="inspector-field wide">
            <span>Paper</span>
            <Select
              label="Staff paper"
              value={source.props.background === 'transparent' ? 'transparent' : 'paper'}
              onChange={value => prop('background', value === 'transparent' ? 'transparent' : 'rgba(255,255,255,0.94)')}
              options={[
                { value: 'paper', label: 'White paper' },
                { value: 'transparent', label: 'Transparent' },
              ]}
            />
          </div>
          <label className="inspector-check">
            <input
              type="checkbox"
              checked={source.props.namePlayed !== false}
              onChange={event => prop('namePlayed', event.target.checked)}
            />
            Name the notes being played
          </label>
          <small className="field-hint">
            Shows what is sounding right now on a grand staff. Sharps or flats follow
            the accidental setting, so the spelling matches the key you are teaching in.
          </small>
        </>
      )}

      {(source.kind === 'text' || source.kind === 'chord') && (
        <>
          <label className="section-label">{source.kind === 'text' ? 'Text' : 'Chord readout'}</label>
          {source.kind === 'text' && (
            <label className="inspector-field wide">
              <span>Content</span>
              <textarea
                aria-label="Text content"
                rows={3}
                value={source.props.text ?? ''}
                onChange={event => prop('text', event.target.value)}
              />
            </label>
          )}
          <label className="inspector-field wide">
            <span>Size {source.props.fontSize ?? 72} px</span>
            <input
              type="range" min={16} max={220}
              aria-label="Font size"
              value={source.props.fontSize ?? 72}
              onChange={event => prop('fontSize', Number(event.target.value))}
            />
          </label>
          <div className="inspector-field wide">
            <span>Align</span>
            <Select
              label="Text alignment"
              value={source.props.align ?? 'left'}
              onChange={value => prop('align', value as 'left' | 'center' | 'right')}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Centre' },
                { value: 'right', label: 'Right' },
              ]}
            />
          </div>
          <label className="inspector-field wide">
            <span>Colour</span>
            <input
              type="color"
              aria-label="Text colour"
              value={source.props.color ?? '#ffffff'}
              onChange={event => prop('color', event.target.value)}
            />
          </label>
          {source.kind === 'chord' && (
            <>
              <div className="inspector-field wide">
                <span>Show</span>
                <Select
                  label="Chord display"
                  value={source.props.chordMode ?? 'both'}
                  onChange={value => prop('chordMode', value as ChordDisplayMode)}
                  options={[
                    { value: 'names', label: 'Chord names (Cmaj7)' },
                    { value: 'numerals', label: 'Numbers in the key (IV7)' },
                    { value: 'both', label: 'Both' },
                  ]}
                />
              </div>
              {(source.props.chordMode ?? 'both') !== 'names' && (
                <label className="inspector-field wide">
                  <span>Number size {Math.round((source.props.numeralScale ?? 0.5) * 100)}% of the name</span>
                  <input
                    type="range" min={20} max={300}
                    aria-label="Number size"
                    value={Math.round((source.props.numeralScale ?? 0.5) * 100)}
                    onChange={event => prop('numeralScale', Number(event.target.value) / 100)}
                  />
                </label>
              )}
            </>
          )}
        </>
      )}

      {source.kind === 'color' && (
        <label className="inspector-field wide">
          <span>Colour</span>
          <input
            type="color"
            aria-label="Block colour"
            value={source.props.background ?? '#0b1a2b'}
            onChange={event => prop('background', event.target.value)}
          />
        </label>
      )}

      {source.kind === 'image' && (
        <>
          <ZoomControls source={source} onProp={prop} />
        </>
      )}

      {source.kind === 'image' && (
        <label className="inspector-field wide">
          <span>Image file</span>
          <input
            type="file"
            accept="image/*"
            aria-label="Choose image"
            onChange={event => {
              const file = event.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              // Stored inline so the scene stays self-contained when reloaded.
              reader.onload = () => prop('src', String(reader.result));
              reader.readAsDataURL(file);
            }}
          />
        </label>
      )}

      <hr />
      <button className="danger-action" onClick={onRemove}><Trash2 size={14} />Remove source</button>
    </div>
  );
}


/* ------------------------------------------------------------------ *
 * Go live
 * ------------------------------------------------------------------ */

/**
 * Start and stop the stream without leaving the Tutorial page, since going
 * live and starting a recording are the same moment in a lesson.
 *
 * Destinations and keys are set up on the Stream page; with none ready this
 * button takes you there rather than failing silently.
 */
function GoLiveButton({
  frameRate, quality, onNotice, onOpenStream,
}: {
  frameRate: number;
  quality: QualityLevel;
  onNotice: (message: string) => void;
  onOpenStream?: () => void;
}) {
  const [status, setStatus] = useState<StreamStatus>(EMPTY_STATUS);
  const [busy, setBusy] = useState(false);

  useEffect(() => liveStreamer.subscribe(setStatus), []);

  const live = status.state === 'live' || status.state === 'starting';

  const toggle = async () => {
    if (live) {
      setBusy(true);
      await liveStreamer.stop();
      setBusy(false);
      return;
    }
    const destinations = loadDestinations().filter(destination => destination.enabled);
    if (!destinations.length || validateAll(destinations).length) {
      onNotice('Set up a destination and stream key on the Stream page first.');
      onOpenStream?.();
      return;
    }
    setBusy(true);
    const failure = await liveStreamer.start(destinations, { frameRate, level: quality });
    setBusy(false);
    if (failure) onNotice(failure);
  };

  return (
    <button
      className={`go-live ${live ? 'active' : ''}`}
      onClick={() => void toggle()}
      disabled={busy}
      title={live ? 'Stop streaming' : 'Go live'}
      aria-label={live ? 'Stop streaming' : 'Go live'}
    >
      {live ? <Square size={15} fill="currentColor" /> : <Radio size={17} />}
      <small>{busy ? '…' : live ? 'LIVE' : 'GO LIVE'}</small>
    </button>
  );
}
