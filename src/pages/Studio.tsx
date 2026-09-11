import { useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, Camera, ChevronsDown, ChevronsUp, Circle, Copy, Eye, EyeOff,
  Image as ImageIcon, Keyboard, Lock, Maximize, Mic2, Move, Music2, Piano, Plus,
  RotateCcw, Square, Trash2, Type, Unlock, Volume2,
} from 'lucide-react';
import { SceneCanvas } from '../components/SceneCanvas';
import { DeviceSelect, Select } from '../components/Select';
import { Meter, formatDb } from '../components/common';
import { useStudio } from '../lib/useStudio';
import { detectChord, romanNumeral } from '../lib/chords';
import { formatDuration } from '../lib/settings';
import {
  CANVAS_HEIGHT, CANVAS_WIDTH, centreRect, fillCanvas, fitToCanvas, reorder,
  type Source, type SourceKind,
} from '../lib/scene';
import { midiManager } from '../lib/midi';
import { cameraHub } from '../lib/cameraHub';

const SOURCE_KINDS: Array<{ kind: SourceKind; label: string; Icon: typeof Camera }> = [
  { kind: 'camera', label: 'Camera', Icon: Camera },
  { kind: 'keyboard', label: 'Piano keyboard', Icon: Piano },
  { kind: 'text', label: 'Text', Icon: Type },
  { kind: 'chord', label: 'Chord readout', Icon: Music2 },
  { kind: 'image', label: 'Image', Icon: ImageIcon },
  { kind: 'color', label: 'Colour block', Icon: Square },
];

export function Studio() {
  const {
    settings, updateSettings, catalog, activeNotes, noteOn, noteOff, panic, levels,
    channels, attachInput, detachInput,
    recording, elapsedMs, startRecording, stopRecording,
    scenes, activeScene, activeSceneId, selectScene, addScene, duplicateScene,
    renameScene, deleteScene, setSceneSources, addSource, updateSource, removeSource,
    selectedSourceId, setSelectedSourceId,
  } = useStudio();

  const [midiInputId, setMidiInputId] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const micChannel = channels.find(channel => channel.id === 'mic1');
  const selected = activeScene?.sources.find(source => source.id === selectedSourceId) ?? null;

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
    setSceneSources(reorder(activeScene.sources, selected.id, direction));
  };

  const addSourceOfKind = (kind: SourceKind) => {
    setAddMenuOpen(false);
    // A new camera picks the first device that is not already on the canvas.
    if (kind === 'camera') {
      const used = new Set(activeScene?.sources.filter(s => s.kind === 'camera').map(s => s.props.deviceId));
      const free = catalog.videoInputs.find(device => !used.has(device.id)) ?? catalog.videoInputs[0];
      addSource('camera', {
        name: free?.name ?? 'Camera',
        props: { deviceId: free?.id },
      });
      return;
    }
    addSource(kind);
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
                value={midiInputId}
                onChange={value => {
                  setMidiInputId(value);
                  midiManager.setEnabledInputs(value ? [value] : undefined);
                }}
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
          {scenes.map(scene => (
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
              <small>{scene.sources.length} source{scene.sources.length === 1 ? '' : 's'}</small>
              <span className="scene-row-actions">
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
            {SOURCE_KINDS.map(({ kind, label, Icon }) => (
              <button key={kind} onClick={() => addSourceOfKind(kind)}>
                <Icon size={14} />{label}
              </button>
            ))}
          </div>
        )}
        <div className="source-layers">
          {/* Topmost layer first, the way a layer list reads. */}
          {[...(activeScene?.sources ?? [])].reverse().map(source => (
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
          {activeScene && !activeScene.sources.length && (
            <p className="panel-hint">No sources yet. Use + to add a camera, the keyboard, or text.</p>
          )}
        </div>
      </aside>

      {/* -------------------------------------------------------- centre */}
      <section className="studio-center">
        <div className="canvas-shell">
          <div className="canvas-topline">
            <span>
              <Circle size={8} fill={recording ? '#ff4c55' : '#39dfa0'} color={recording ? '#ff4c55' : '#39dfa0'} />
              {recording ? ' RECORDING' : ' LIVE PREVIEW'}
            </span>
            <span>{CANVAS_WIDTH} × {CANVAS_HEIGHT} · this frame is what gets recorded</span>
          </div>

          {activeScene ? (
            <SceneCanvas
              scene={activeScene}
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
        <div className="inspector-title"><span>{selected ? 'Source properties' : 'Inspector'}</span></div>
        {selected ? (
          <SourceInspector
            source={selected}
            cameras={catalog.videoInputs}
            onChange={patch => updateSource(selected.id, patch)}
            onRemove={() => removeSource(selected.id)}
            onLayer={layerAction}
          />
        ) : (
          <p className="panel-hint">
            Select a source on the canvas to move, resize and style it.
            Drag to move, pull the handles to resize, hold Shift to keep the shape,
            hold Alt to ignore the guides, and use the arrow keys to nudge.
          </p>
        )}
      </aside>
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * Inspector
 * ------------------------------------------------------------------ */

function SourceInspector({
  source, cameras, onChange, onRemove, onLayer,
}: {
  source: Source;
  cameras: Array<{ id: string; name: string }>;
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
        <button onClick={() => onChange(fillCanvas())}><Maximize size={13} />Fill screen</button>
        <button onClick={() => onChange(centreRect(source))}><Move size={13} />Centre</button>
        <button onClick={() => onChange(fitToCanvas(source.width / source.height))}>Fit</button>
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

      {source.kind === 'camera' && (
        <>
          <label className="section-label">Camera</label>
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
                onChange({ props: { firstNote: first, lastNote: last } });
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
              value={source.props.accent ?? '#1d9cff'}
              onChange={event => prop('accent', event.target.value)}
            />
          </label>
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
            <label className="inspector-check">
              <input
                type="checkbox"
                checked={source.props.showRoman !== false}
                onChange={event => prop('showRoman', event.target.checked)}
              />
              Show Roman numeral
            </label>
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

