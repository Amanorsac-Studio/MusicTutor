import { useEffect, useRef, useState } from 'react';
import {
  AudioLines, Camera, Headphones, Keyboard, Piano, Play, Plus, RotateCcw, Volume2, X, Zap,
} from 'lucide-react';
import { DeviceSelect, Select } from '../components/Select';
import { Meter, Toggle, formatDb } from '../components/common';
import { useStudio } from '../lib/useStudio';
import { audioEngine } from '../lib/audioEngine';
import { midiManager } from '../lib/midi';

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
  } = useStudio();

  const [permission, setPermission] = useState<'idle' | 'pending' | 'ready' | 'blocked'>('idle');
  const [routes, setRoutes] = useState<Record<string, string>>({});
  const [camera2On, setCamera2On] = useState(false);
  const [camera1Id, setCamera1Id] = useState('');
  const [camera2Id, setCamera2Id] = useState('');
  const [cameraError, setCameraError] = useState('');

  const video1 = useRef<HTMLVideoElement>(null);
  const video2 = useRef<HTMLVideoElement>(null);
  const stream1 = useRef<MediaStream | null>(null);
  const stream2 = useRef<MediaStream | null>(null);

  const selected1 = camera1Id || catalog.videoInputs[0]?.id || '';
  const selected2 = camera2Id || catalog.videoInputs[1]?.id || catalog.videoInputs[0]?.id || '';

  useEffect(() => () => {
    stream1.current?.getTracks().forEach(track => track.stop());
    stream2.current?.getTracks().forEach(track => track.stop());
  }, []);

  const openCamera = async (
    deviceId: string,
    element: HTMLVideoElement | null,
    slot: React.MutableRefObject<MediaStream | null>,
  ) => {
    slot.current?.getTracks().forEach(track => track.stop());
    slot.current = null;
    if (!deviceId || !element) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });
      slot.current = stream;
      element.srcObject = stream;
      await element.play().catch(() => {});
      setCameraError('');
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Camera could not be opened');
    }
  };

  const connect = async () => {
    setPermission('pending');
    await refreshDevices(true);
    await openCamera(selected1, video1.current, stream1);
    // catalog.media reflects whether the permission prompt succeeded.
    setPermission(catalog.media.state === 'denied' ? 'blocked' : 'ready');
  };

  useEffect(() => {
    if (catalog.media.state === 'denied') setPermission('blocked');
  }, [catalog.media.state]);

  const toggleCamera2 = async (next: boolean) => {
    setCamera2On(next);
    if (!next) {
      stream2.current?.getTracks().forEach(track => track.stop());
      stream2.current = null;
      return;
    }
    await openCamera(selected2, video2.current, stream2);
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
        <section className="content-card camera-card">
          <div className="card-title">
            <div><Camera /><span><b>Camera 1</b><small>Face camera</small></span></div>
            <span className={`status ${stream1.current ? '' : 'offline'}`}>{stream1.current ? 'ACTIVE' : 'OFFLINE'}</span>
          </div>
          <div className="video-preview">
            <video ref={video1} muted playsInline />
            {!stream1.current && (
              <span className="preview-placeholder"><Camera size={38} /><small>Connect to preview</small></span>
            )}
          </div>
          <div className="two-fields">
            <DeviceSelect
              devices={catalog.videoInputs}
              value={selected1}
              onChange={value => { setCamera1Id(value); void openCamera(value, video1.current, stream1); }}
              label="Camera 1 device"
              emptyLabel="No cameras found"
            />
            <Select
              label="Camera 1 format"
              value="1080p30"
              onChange={() => { /* format follows the recording quality setting */ }}
              options={[
                { value: '720p30', label: '1280 × 720 · 30 fps' },
                { value: '1080p30', label: '1920 × 1080 · 30 fps' },
                { value: '1080p60', label: '1920 × 1080 · 60 fps' },
              ]}
            />
          </div>
        </section>

        <section className="content-card camera-card">
          <div className="card-title">
            <div><Camera /><span><b>Camera 2</b><small>Hands camera</small></span></div>
            <Toggle value={camera2On} onChange={value => void toggleCamera2(value)} label="Camera 2" disabled={!catalog.videoInputs.length} />
          </div>
          <div className="video-preview">
            <video ref={video2} muted playsInline />
            {!camera2On && (
              <span className="preview-placeholder"><Plus /><small>Select a second camera</small></span>
            )}
          </div>
          <DeviceSelect
            devices={catalog.videoInputs}
            value={selected2}
            onChange={value => { setCamera2Id(value); if (camera2On) void openCamera(value, video2.current, stream2); }}
            label="Camera 2 device"
            emptyLabel="No cameras found"
          />
        </section>

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
          <DeviceSelect
            devices={catalog.midiInputs}
            value={catalog.midiInputs[0]?.id ?? ''}
            onChange={() => { /* every connected input is listened to */ }}
            label="MIDI input device"
            emptyLabel={catalog.midi.message ?? 'No MIDI devices detected'}
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

      {(permission === 'blocked' || cameraError) && (
        <div className="toast error">
          <X />
          {cameraError || 'Camera or microphone access was blocked. Allow access in Windows privacy settings, then reconnect.'}
        </div>
      )}
    </div>
  );
}
