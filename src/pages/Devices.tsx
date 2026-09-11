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
import { INPUT_SLOTS, describeInputQuality } from '../lib/inputs';
import { createCameraSource, type CameraRole } from '../lib/scene';

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
  const addCameraToScene = (role: CameraRole, deviceId: string, name: string) => {
    if (!deviceId) { setNotice(`Choose a device for the ${name.toLowerCase()} first.`); return; }
    // createCameraSource shapes the frame for the role: a 16:9 box for a face
    // shot, a wide overhead strip for hands.
    const template = createCameraSource(role, deviceId, name);
    const id = addSource('camera', {
      name: template.name,
      x: template.x, y: template.y, width: template.width, height: template.height,
      props: template.props,
    });
    if (id) setNotice(`${name} added to ${activeScene?.name ?? 'the scene'} — arrange it in the Tutorial tab.`);
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
        <CameraRoleCard
          role="face"
          title="Face camera"
          subtitle="Head and shoulders, 16:9"
          cameras={catalog.videoInputs}
          deviceId={settings.faceCameraId}
          onDevice={id => updateSettings({ faceCameraId: id })}
          onAddToScene={addCameraToScene}
          sceneName={activeScene?.name}
        />
        <CameraRoleCard
          role="hand"
          title="Hand camera"
          subtitle="Overhead view of the keys, wide strip"
          cameras={catalog.videoInputs}
          deviceId={settings.handCameraId}
          onDevice={id => updateSettings({ handCameraId: id })}
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
              const quality = describeInputQuality(channel?.channelCount, channel?.sampleRate);
              return (
                <div key={slot.id}>
                  <span className="device-num">{index + 1}</span>
                  <span>
                    <b>{slot.label}</b>
                    <small>
                      {channel?.error
                        ? channel.error
                        : channel?.connected
                          ? `${quality || 'Connected'} · ${formatDb(level?.rms)} dBFS`
                          : slot.hint}
                    </small>
                  </span>
                  <Meter level={level} label={`${slot.label} level`} />
                  <DeviceSelect
                    devices={catalog.audioInputs}
                    value={routes[slot.id] ?? ''}
                    onChange={value => void assignInput(slot.id, value, slot.label, slot.isVoice)}
                    label={`${slot.label} source`}
                    emptyLabel="No inputs found"
                    allowNone
                    noneLabel="Not assigned"
                  />
                </div>
              );
            })}
          </div>
          <p className="panel-hint">
            Inputs are captured with echo cancellation, noise suppression and auto gain all
            switched off, so a line input or a virtual cable arrives unprocessed. To capture a
            plug-in host such as Kontakt, route its output to a virtual audio device and pick
            that device on the App audio slot.
          </p>
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

/**
 * One card per teaching role rather than per detected device. A lesson has a
 * face shot and an overhead hand shot; which physical camera fills each is a
 * setting, not a separate card.
 */
function CameraRoleCard({
  role, title, subtitle, cameras, deviceId, onDevice, onAddToScene, sceneName,
}: {
  role: CameraRole;
  title: string;
  subtitle: string;
  cameras: Array<{ id: string; name: string }>;
  deviceId: string;
  onDevice: (id: string) => void;
  onAddToScene: (role: CameraRole, deviceId: string, name: string) => void;
  sceneName?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const [format, setFormat] = useState('1080p30');

  const selected = deviceId || cameras[0]?.id || '';

  const open = async () => {
    if (!selected) { setError('No camera selected'); return; }
    await cameraHub.acquire(selected, title);
    const failure = cameraHub.errorFor(selected);
    if (failure) { setError(failure); setLive(false); return; }
    if (videoRef.current) {
      videoRef.current.srcObject = cameraHub.stream(selected) ?? null;
      await videoRef.current.play().catch(() => {});
    }
    setError('');
    setLive(true);
  };

  const close = () => {
    if (videoRef.current) videoRef.current.srcObject = null;
    if (selected) cameraHub.release(selected);
    setLive(false);
  };

  useEffect(() => () => { if (live && selected) cameraHub.release(selected); }, [live, selected]);

  const applyFormat = async (next: string) => {
    setFormat(next);
    const [width, height, frameRate] = next === '720p30'
      ? [1280, 720, 30]
      : next === '1080p60' ? [1920, 1080, 60] : [1920, 1080, 30];
    const failure = await cameraHub.applyFormat(selected, width, height, frameRate);
    if (failure) setError(failure);
  };

  return (
    <section className="content-card camera-card">
      <div className="card-title">
        <div>
          <Camera />
          <span><b>{title}</b><small>{error || (live ? 'Live' : subtitle)}</small></span>
        </div>
        <Toggle
          value={live}
          onChange={next => (next ? void open() : close())}
          label={`Preview ${title}`}
          disabled={!cameras.length}
        />
      </div>

      <div className={`video-preview ${role === 'hand' ? 'hand-shot' : ''}`}>
        <video ref={videoRef} className="source-video" muted playsInline autoPlay />
        {!live && (
          <span className="preview-placeholder">
            <Camera size={34} />
            <small>{cameras.length ? 'Turn on to preview' : 'No cameras detected'}</small>
          </span>
        )}
      </div>

      <div className="two-fields">
        <DeviceSelect
          devices={cameras}
          value={selected}
          onChange={id => { if (live) close(); onDevice(id); }}
          label={`${title} device`}
          emptyLabel="No cameras found"
        />
        <Select
          label={`${title} format`}
          value={format}
          onChange={value => void applyFormat(value)}
          options={[
            { value: '720p30', label: '1280 × 720 · 30 fps' },
            { value: '1080p30', label: '1920 × 1080 · 30 fps' },
            { value: '1080p60', label: '1920 × 1080 · 60 fps' },
          ]}
        />
      </div>

      <button className="primary small wide" onClick={() => onAddToScene(role, selected, title)}>
        <Plus size={14} />Add to scene
      </button>
      <small className="field-hint">
        {sceneName
          ? `Adds a ${role === 'hand' ? 'wide overhead strip' : '16:9 box'} to ${sceneName}.`
          : 'Create a scene in the Tutorial tab first.'}
      </small>
    </section>
  );
}
