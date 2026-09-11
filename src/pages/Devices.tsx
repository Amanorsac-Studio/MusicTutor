import { useEffect, useRef, useState } from 'react';
import {
  AudioLines, Camera, Headphones, Keyboard, Piano, Play, Plus, RotateCcw, Volume2, X, Zap,
} from 'lucide-react';
import { DeviceSelect, Select } from '../components/Select';
import { Meter, Toggle, formatDb } from '../components/common';
import { useStudio } from '../lib/useStudio';
import { audioEngine } from '../lib/audioEngine';
import { midiManager } from '../lib/midi';
import { cameraHub } from '../lib/cameraHub';

/** The four mixer inputs a lesson setup normally uses. */
const INPUT_SLOTS = [
  { id: 'mic1', label: 'Mic 1', hint: 'Teacher voice', isVoice: true },
  { id: 'mic2', label: 'Mic 2', hint: 'Second voice or room', isVoice: true },
  { id: 'inst1', label: 'Instrument 1', hint: 'Keyboard or piano mic', isVoice: false },
  { id: 'inst2', label: 'Instrument 2', hint: 'Second instrument', isVoice: false },
];

export function Devices() {
  const {
    catalog, refreshDevices, channels, levels, attachInput, detachInput, settings, updateSettings,
    addSource, activeScene, setNotice,
  } = useStudio();

  const [permission, setPermission] = useState<'idle' | 'pending' | 'ready' | 'blocked'>('idle');
  const [routes, setRoutes] = useState<Record<string, string>>({});
  const [midiInputId, setMidiInputId] = useState('');

  const connect = async () => {
    setPermission('pending');
    await refreshDevices(true);
    setPermission(catalog.media.state === 'denied' ? 'blocked' : 'ready');
  };

  useEffect(() => {
    if (catalog.media.state === 'denied') setPermission('blocked');
  }, [catalog.media.state]);

  /**
   * Put a camera straight onto the current scene. This is the link between the
   * two pages: a camera connected here becomes a source you can position in the
   * Tutorial workspace.
   */
  const addCameraToScene = (deviceId: string, name: string) => {
    const id = addSource('camera', { name, props: { deviceId } });
    if (id) setNotice(`${name} added to "${activeScene?.name ?? 'the scene'}" — arrange it in the Tutorial tab.`);
    else setNotice('Create a scene in the Tutorial tab first.');
  };

  const assignInput = async (slotId: string, deviceId: string, label: string, isVoice: boolean) => {
    setRoutes(current => ({ ...current, [slotId]: deviceId }));
    if (!deviceId) {
      detachInput(slotId);
      return;
    }
    await attachInput({ id: slotId, label, deviceId, isVoice });
  };

  const channelFor = (id: string) => channels.find(channel => channel.id === id);

  return (
    <div className="workspace-page">
      <header>
        <div>
          <span className="eyebrow">HARDWARE SETUP</span>
          <h1>Devices</h1>
          <p>Connect cameras, microphones, MIDI, and monitoring.</p>
        </div>
        <button className="primary small" onClick={() => void connect()}>
          <Zap size={15} />
          {permission === 'pending' ? 'Requesting…' : permission === 'ready' ? 'Refresh devices' : 'Connect devices'}
        </button>
      </header>

      {catalog.media.message && (
        <div className={`page-banner ${catalog.media.state === 'denied' ? 'error' : ''}`}>
          {catalog.media.message}
        </div>
      )}

      <div className="page-grid devices-grid">
        <CameraCards
          cameras={catalog.videoInputs}
          onAddToScene={addCameraToScene}
          sceneName={activeScene?.name}
        />

        <section className="content-card span-two">
          <div className="card-title">
            <div>
              <AudioLines />
              <span>
                <b>Audio inputs</b>
                <small>
                  {catalog.audioInputs.length} capture endpoint{catalog.audioInputs.length === 1 ? '' : 's'} available
                  {catalog.labelsVisible ? '' : ' — connect to see device names'}
                </small>
              </span>
            </div>
            <button className="icon-btn" onClick={() => void refreshDevices(true)} aria-label="Refresh audio devices">
              <RotateCcw size={16} />
            </button>
          </div>
          <div className="device-rows">
            {INPUT_SLOTS.map((slot, index) => {
              const channel = channelFor(slot.id);
              const level = levels[slot.id];
              return (
                <div key={slot.id}>
                  <span className="device-num">{index + 1}</span>
                  <span>
                    <b>{slot.label}</b>
                    <small>
                      {channel?.error
                        ? channel.error
                        : channel?.connected
                          ? `${catalog.audioInputs.find(d => d.id === routes[slot.id])?.name ?? 'Connected'} · ${formatDb(level?.rms)} dBFS`
                          : slot.hint}
                    </small>
                  </span>
                  <Meter level={level} label={`${slot.label} level`} />
                  <DeviceSelect
                    devices={catalog.audioInputs}
                    value={routes[slot.id] ?? ''}
                    onChange={value => void assignInput(slot.id, value, slot.label, slot.isVoice)}
                    label={`${slot.label} source`}
                    emptyLabel="No microphones found"
                    allowNone
                    noneLabel="Not assigned"
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className="content-card">
          <div className="card-title">
            <div><Keyboard /><span><b>MIDI input</b><small>Visualisation + built-in instrument</small></span></div>
            <span className={`status ${catalog.midiInputs.length ? '' : 'offline'}`}>
              {catalog.midi.state === 'denied' ? 'BLOCKED'
                : catalog.midi.state === 'unsupported' ? 'UNAVAILABLE'
                  : catalog.midiInputs.length ? 'CONNECTED' : 'NO DEVICE'}
            </span>
          </div>
          <Select
            label="MIDI input device"
            value={midiInputId}
            onChange={value => {
              setMidiInputId(value);
              midiManager.setEnabledInputs(value ? [value] : undefined);
            }}
            options={[
              { value: '', label: catalog.midiInputs.length ? 'All MIDI inputs' : (catalog.midi.message ?? 'No MIDI devices detected') },
              ...catalog.midiInputs.map(port => ({
                value: port.id,
                label: port.manufacturer ? `${port.name} — ${port.manufacturer}` : port.name,
              })),
            ]}
          />
          {catalog.midi.message && <small className="field-hint">{catalog.midi.message}</small>}
          <div className="midi-strip">
            <Piano />
            <span>
              <b>Built-in grand piano</b>
              <small>{catalog.midiInputs[0]?.name ?? 'Computer keyboard'} · Channel 1</small>
            </span>
            <button
              aria-label="Test instrument"
              onClick={() => {
                void audioEngine.resume();
                [60, 64, 67].forEach((note, i) => {
                  window.setTimeout(() => audioEngine.noteOn(note, 0.8), i * 120);
                  window.setTimeout(() => audioEngine.noteOff(note), 900 + i * 120);
                });
              }}
            ><Play size={14} /></button>
          </div>
          <button className="subtle-btn" onClick={() => void refreshDevices(false)}>
            <RotateCcw size={14} />Rescan MIDI
          </button>
        </section>

        <section className="content-card">
          <div className="card-title">
            <div><Headphones /><span><b>Monitoring</b><small>Independent from the recording</small></span></div>
            <b className="monitor-value">{Math.round(settings.monitorLevel * 100)}%</b>
          </div>
          <DeviceSelect
            devices={catalog.audioOutputs}
            value={settings.outputDeviceId || catalog.audioOutputs[0]?.id || ''}
            onChange={value => updateSettings({ outputDeviceId: value })}
            label="Monitoring output"
            emptyLabel="Default output"
          />
          <div className="monitor-level">
            <Volume2 />
            <input
              aria-label="Monitoring level"
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.monitorLevel * 100)}
              onChange={event => updateSettings({ monitorLevel: Number(event.target.value) / 100 })}
            />
          </div>
          <div className="midi-strip">
            <AudioLines />
            <span><b>Master output</b><small>{formatDb(levels.master?.rms)} dBFS</small></span>
            <Meter level={levels.master} label="Master level" />
          </div>
        </section>
      </div>

      {permission === 'blocked' && (
        <div className="toast error">
          <X />
          Camera or microphone access was blocked. Allow access in Windows privacy settings, then reconnect.
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Cameras
 * ------------------------------------------------------------------ */

/** One card per detected camera, each previewing through the shared hub. */
function CameraCards({
  cameras, onAddToScene, sceneName,
}: {
  cameras: Array<{ id: string; name: string }>;
  onAddToScene: (deviceId: string, name: string) => void;
  sceneName?: string;
}) {
  if (!cameras.length) {
    return (
      <section className="content-card span-two">
        <div className="card-title">
          <div><Camera /><span><b>Cameras</b><small>None detected</small></span></div>
        </div>
        <p className="panel-hint">
          Connect a camera, then press “Connect devices” above to grant access and list it here.
        </p>
      </section>
    );
  }
  return (
    <>
      {cameras.map(camera => (
        <CameraCard key={camera.id} camera={camera} onAddToScene={onAddToScene} sceneName={sceneName} />
      ))}
    </>
  );
}

function CameraCard({
  camera, onAddToScene, sceneName,
}: {
  camera: { id: string; name: string };
  onAddToScene: (deviceId: string, name: string) => void;
  sceneName?: string;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const [format, setFormat] = useState('1080p30');

  const open = async () => {
    const element = await cameraHub.acquire(camera.id, camera.name);
    const failure = cameraHub.errorFor(camera.id);
    if (failure) { setError(failure); setLive(false); return; }
    const view = document.createElement('video');
    view.muted = true; view.playsInline = true; view.autoplay = true;
    view.srcObject = element.srcObject;
    view.className = 'source-video';
    holderRef.current?.replaceChildren(view);
    await view.play().catch(() => {});
    setError('');
    setLive(true);
  };

  const close = () => {
    holderRef.current?.replaceChildren();
    cameraHub.release(camera.id);
    setLive(false);
  };

  useEffect(() => () => { if (live) cameraHub.release(camera.id); }, [live, camera.id]);

  const applyFormat = async (next: string) => {
    setFormat(next);
    const [width, height, frameRate] = next === '720p30'
      ? [1280, 720, 30]
      : next === '1080p60' ? [1920, 1080, 60] : [1920, 1080, 30];
    const failure = await cameraHub.applyFormat(camera.id, width, height, frameRate);
    if (failure) setError(failure);
  };

  return (
    <section className="content-card camera-card">
      <div className="card-title">
        <div><Camera /><span><b>{camera.name}</b><small>{error || (live ? 'Live' : 'Not started')}</small></span></div>
        <Toggle value={live} onChange={next => (next ? void open() : close())} label={`Preview ${camera.name}`} />
      </div>
      <div className="video-preview" ref={holderRef}>
        {!live && (
          <span className="preview-placeholder"><Camera size={34} /><small>Turn on to preview</small></span>
        )}
      </div>
      <div className="two-fields">
        <Select
          label={`${camera.name} format`}
          value={format}
          onChange={value => void applyFormat(value)}
          options={[
            { value: '720p30', label: '1280 × 720 · 30 fps' },
            { value: '1080p30', label: '1920 × 1080 · 30 fps' },
            { value: '1080p60', label: '1920 × 1080 · 60 fps' },
          ]}
        />
        <button className="primary small" onClick={() => onAddToScene(camera.id, camera.name)}>
          <Plus size={14} />Add to scene
        </button>
      </div>
      <small className="field-hint">
        {sceneName ? `Adds a camera source to “${sceneName}”, ready to position in the Tutorial tab.` : 'Create a scene first.'}
      </small>
    </section>
  );
}
