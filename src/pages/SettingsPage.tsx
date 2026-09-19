import { useEffect, useState } from 'react';
import { FolderOpen, Gauge, Radio, RotateCcw, Save, Settings as SettingsIcon, Zap } from 'lucide-react';
import { Select } from '../components/Select';
import { Toggle } from '../components/common';
import { useStudio } from '../lib/useStudio';
import { QUALITY_PRESETS, pickMimeType } from '../lib/recorder';
import { KEY_RANGES } from '../components/PianoKeyboard';
import { KEY_NAMES } from '../lib/chords';
import type { AppSettings } from '../lib/settings';

const TABS = ['Recording', 'Audio & MIDI', 'Video', 'Storage', 'Shortcuts', 'Appearance'] as const;
type Tab = (typeof TABS)[number];

export function SettingsPage() {
  const { settings, updateSettings, persistSettings, catalog, refreshDevices } = useStudio();
  const [active, setActive] = useState<Tab>('Recording');
  const [status, setStatus] = useState('');
  const [paths, setPaths] = useState<{ projects: string; recordings: string } | null>(null);

  useEffect(() => {
    void window.pianoTutorDesktop?.paths?.().then(setPaths).catch(() => setPaths(null));
  }, []);

  useEffect(() => {
    if (!status) return;
    const id = window.setTimeout(() => setStatus(''), 3000);
    return () => window.clearTimeout(id);
  }, [status]);

  const save = async () => {
    const path = await persistSettings();
    setStatus(path ? `Settings saved to ${path}` : 'Settings saved in this browser');
  };

  const line = (title: string, detail: string, control: React.ReactNode) => (
    <div className="setting-line" key={title}>
      <span><b>{title}</b><small>{detail}</small></span>
      {control}
    </div>
  );

  const set = <K extends keyof AppSettings>(key: K) => (value: AppSettings[K]) => updateSettings({ [key]: value } as Partial<AppSettings>);

  let content: React.ReactNode;

  if (active === 'Recording') {
    content = (
      <>
        {line('Video quality', 'Resolution, frame rate and bitrate for new recordings',
          <Select
            label="Video quality"
            value={String(settings.quality)}
            onChange={set('quality')}
            options={Object.entries(QUALITY_PRESETS).map(([id, preset]) => ({ value: id, label: preset.label }))}
          />)}
        {line('Container and codec', 'Chosen automatically from what this system supports',
          <span className="static-value">{pickMimeType() ?? 'Not supported'}</span>)}
        {line('Record audio', 'Capture the full program mix — piano, MIDI instrument and microphones',
          <Toggle value={settings.recordAudio} onChange={set('recordAudio')} label="Record audio" />)}
        {line('Record MIDI', 'Also write a Standard MIDI File alongside the video',
          <Toggle value={settings.recordMidi} onChange={set('recordMidi')} label="Record MIDI" />)}
        {line('Autosave preferences', 'Save changes on this page automatically',
          <Toggle value={settings.autosave} onChange={set('autosave')} label="Autosave" />)}
      </>
    );
  } else if (active === 'Audio & MIDI') {
    content = (
      <>
        {line('Output device', 'Where monitoring is sent',
          <Select
            label="Output device"
            value={settings.outputDeviceId}
            onChange={set('outputDeviceId')}
            options={[
              { value: '', label: 'System default' },
              ...catalog.audioOutputs.map(device => ({ value: device.id, label: device.name })),
            ]}
          />)}
        {line('Concert pitch', 'Reference frequency for A4 — ISO 16 standard is 440 Hz',
          <Select
            label="Concert pitch"
            value={String(settings.concertPitch)}
            onChange={value => updateSettings({ concertPitch: Number(value) })}
            options={[415, 430, 432, 435, 438, 440, 441, 442, 443, 444].map(hz => ({
              value: String(hz), label: `${hz} Hz${hz === 440 ? ' (standard)' : ''}`,
            }))}
          />)}
        {line('Safety limiter', 'Prevents the master bus from clipping',
          <Toggle value={settings.limiter} onChange={set('limiter')} label="Safety limiter" />)}
        {line('Forward notes to MIDI output', 'Off by default — forwarding a keyboard to itself causes a feedback loop',
          <Toggle value={settings.midiEcho} onChange={set('midiEcho')} label="MIDI echo" />)}
        {line('MIDI devices', catalog.midi.message ?? `${catalog.midiInputs.length} input(s), ${catalog.midiOutputs.length} output(s)`,
          <button className="subtle-btn" onClick={() => void refreshDevices(false).then(() => setStatus('MIDI rescanned'))}>
            <RotateCcw />Rescan
          </button>)}
      </>
    );
  } else if (active === 'Video') {
    content = (
      <>
        {line('Cameras detected', catalog.labelsVisible ? 'Names are visible' : 'Grant camera access to see device names',
          <span className="static-value">{catalog.videoInputs.length}</span>)}
        {line('Refresh devices', 'Re-scan cameras and microphones',
          <button className="subtle-btn" onClick={() => void refreshDevices(true).then(() => setStatus('Devices rescanned'))}>
            <RotateCcw />Rescan
          </button>)}
      </>
    );
  } else if (active === 'Storage') {
    content = (
      <>
        {line('Project folder', paths?.projects ?? 'Documents\\MusicTutor\\Projects',
          <button className="subtle-btn" onClick={() => void window.pianoTutorDesktop?.openLibraryFolder('projects')}>
            <FolderOpen />Open
          </button>)}
        {line('Recording folder', paths?.recordings ?? 'Videos\\MusicTutor',
          <button className="subtle-btn" onClick={() => void window.pianoTutorDesktop?.openLibraryFolder('recordings')}>
            <FolderOpen />Open
          </button>)}
      </>
    );
  } else if (active === 'Shortcuts') {
    content = (
      <div className="shortcut-list">
        {[
          ['Start / stop recording', 'Ctrl + R'],
          ['Save project', 'Ctrl + S'],
          ['All notes off (panic)', 'Esc'],
          ['Play the virtual keyboard', 'A – ; and W, E, T, Y, U'],
          ['Shift the played octave', 'Z / X'],
        ].map(([name, keys]) => (
          <div className="setting-line" key={name}>
            <span><b>{name}</b></span>
            <kbd>{keys}</kbd>
          </div>
        ))}
      </div>
    );
  } else {
    content = (
      <>
        {line('Interface language', 'Used for dates, times and number formatting',
          <Select
            label="Interface language"
            value={settings.locale}
            onChange={set('locale')}
            options={[
              { value: 'en-US', label: 'English (United States)' },
              { value: 'en-GB', label: 'English (United Kingdom)' },
              { value: 'de-DE', label: 'Deutsch' },
              { value: 'fr-FR', label: 'Français' },
              { value: 'es-ES', label: 'Español' },
              { value: 'ja-JP', label: '日本語' },
            ]}
          />)}
        {line('Note names', 'Spelling used for note and chord labels',
          <Select
            label="Note names"
            value={settings.accidental}
            onChange={value => updateSettings({ accidental: value as AppSettings['accidental'] })}
            options={[{ value: 'sharp', label: 'Sharps (C#)' }, { value: 'flat', label: 'Flats (Db)' }]}
          />)}
        {line('Default key', 'Used for Roman numeral analysis',
          <Select
            label="Default key"
            value={String(settings.keyRoot)}
            onChange={value => updateSettings({ keyRoot: Number(value) })}
            options={KEY_NAMES.map((name, index) => ({ value: String(index), label: name }))}
          />)}
        {line('Keyboard size', 'Range shown by the virtual keyboard',
          <Select
            label="Keyboard size"
            value={settings.keyboardSize}
            onChange={value => updateSettings({ keyboardSize: value as AppSettings['keyboardSize'] })}
            options={Object.keys(KEY_RANGES).map(size => ({ value: size, label: `${size} keys` }))}
          />)}
      </>
    );
  }

  return (
    <div className="workspace-page">
      <header>
        <div>
          <span className="eyebrow">PREFERENCES</span>
          <h1>Settings</h1>
          <p>Recording quality, audio, storage, and shortcuts.</p>
        </div>
        <button className="primary small" onClick={() => void save()}><Save />Save settings</button>
      </header>

      <div className="settings-layout">
        <nav>
          {TABS.map((tab, index) => (
            <button key={tab} onClick={() => setActive(tab)} className={active === tab ? 'active' : ''}>
              {index === 0 ? <Radio /> : <SettingsIcon />}{tab}
            </button>
          ))}
        </nav>

        <section className="settings-sheet">
          <h2>{active}</h2>
          <p>Configure {active.toLowerCase()} preferences for this desktop.</p>
          {content}
          <hr />
          <h2>Performance</h2>
          <div className="diagnostic">
            <Gauge />
            <span>
              <b>{pickMimeType() ? 'Desktop engine ready' : 'Recording unavailable in this environment'}</b>
              <small>
                {catalog.videoInputs.length} camera(s) · {catalog.audioInputs.length} microphone(s) · {catalog.midiInputs.length} MIDI input(s)
              </small>
            </span>
            <span className={`status ${pickMimeType() ? '' : 'offline'}`}>{pickMimeType() ? 'HEALTHY' : 'LIMITED'}</span>
          </div>
          {!window.pianoTutorDesktop && (
            <div className="diagnostic">
              <Zap />
              <span>
                <b>Browser preview</b>
                <small>Recording to disk and the file library need the installed desktop app.</small>
              </span>
            </div>
          )}
          {status && <div className="inline-status">{status}</div>}
        </section>
      </div>
    </div>
  );
}
