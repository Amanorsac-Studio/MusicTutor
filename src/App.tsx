import { useEffect, useState } from 'react';
import {
  Circle, Library, Maximize2, Minus, MonitorPlay, Settings as SettingsIcon,
  Radio, SlidersHorizontal, Upload, Wifi, X,
} from 'lucide-react';
import { StudioProvider, useStudio } from './lib/useStudio';
import { Studio } from './pages/Studio';
import { Devices } from './pages/Devices';
import { Mixer } from './pages/Mixer';
import { LibraryPage } from './pages/LibraryPage';
import { SettingsPage } from './pages/SettingsPage';
import { StreamPage } from './pages/StreamPage';
import { formatDuration } from './lib/settings';

type Workspace = 'Studio' | 'Devices' | 'Mixer' | 'Stream' | 'Library' | 'Settings';

const WORKSPACES: Array<{ id: Workspace; label: string; Icon: typeof MonitorPlay }> = [
  { id: 'Studio', label: 'Tutorial', Icon: MonitorPlay },
  { id: 'Devices', label: 'Devices', Icon: Wifi },
  { id: 'Mixer', label: 'Mixer', Icon: SlidersHorizontal },
  { id: 'Stream', label: 'Stream', Icon: Radio },
  { id: 'Library', label: 'Library', Icon: Library },
  { id: 'Settings', label: 'Settings', Icon: SettingsIcon },
];

function Brand() {
  return (
    <div className="brand">
      <span className="brand-bars" aria-hidden="true">▮▮▮▮</span>
      <strong>Piano<span>Tutor</span></strong>
    </div>
  );
}

function Shell() {
  const [workspace, setWorkspace] = useState<Workspace>('Studio');
  const {
    recording, elapsedMs, startRecording, stopRecording, notice, setNotice,
    panic, settings, updateSettings,
  } = useStudio();

  const desktop = window.pianoTutorDesktop;

  // Global shortcuts. Each ignores keystrokes aimed at a text field.
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        panic();
        return;
      }
      if (!isTyping(event.target)) {
        if (event.key.toLowerCase() === 'z' && !event.ctrlKey && !event.metaKey) {
          updateSettings({ computerKeyOctave: Math.max(-3, settings.computerKeyOctave - 1) });
          return;
        }
        if (event.key.toLowerCase() === 'x' && !event.ctrlKey && !event.metaKey) {
          updateSettings({ computerKeyOctave: Math.min(3, settings.computerKeyOctave + 1) });
          return;
        }
      }
      if (!(event.ctrlKey || event.metaKey)) return;

      const key = event.key.toLowerCase();
      if (key === 'r') {
        event.preventDefault();
        if (recording) void stopRecording();
        else void startRecording();
      } else if (key === 's') {
        event.preventDefault();
        void window.pianoTutorDesktop?.saveProject({
          name: 'PianoTutor Lesson',
          workspace,
          keyRoot: settings.keyRoot,
          mode: settings.mode,
          savedAt: new Date().toISOString(),
        }).then(path => setNotice(path ? `Project saved to ${path}` : 'Project saved'))
          .catch(() => setNotice('Project could not be saved'));
      } else if (key >= '1' && key <= '6') {
        event.preventDefault();
        setWorkspace(WORKSPACES[Number(key) - 1].id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [recording, startRecording, stopRecording, panic, setNotice, workspace, settings.keyRoot, settings.mode, settings.computerKeyOctave, updateSettings]);

  return (
    <div className={`app ${desktop?.isDesktop ? 'desktop-app' : ''}`}>
      <header className="topbar">
        <Brand />
        <nav>
          {WORKSPACES.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={workspace === id ? 'active' : ''}
              aria-current={workspace === id ? 'page' : undefined}
              onClick={() => setWorkspace(id)}
            ><Icon size={17} />{label}</button>
          ))}
        </nav>
        <div className="top-actions">
          <span className={recording ? 'live' : ''}>
            <Circle size={9} fill="currentColor" />
            {recording ? 'REC' : 'READY'} {formatDuration(elapsedMs)}
          </span>
          {desktop?.isDesktop ? (
            <div className="window-controls">
              <button aria-label="Minimise" onClick={() => desktop.minimize()}><Minus /></button>
              <button aria-label="Maximise" onClick={() => desktop.maximize()}><Maximize2 /></button>
              <button aria-label="Close" onClick={() => desktop.close()}><X /></button>
            </div>
          ) : (
            <button title="Export" onClick={() => setWorkspace('Library')}>
              <Upload size={17} /><span>Export</span>
            </button>
          )}
        </div>
      </header>

      {workspace === 'Studio' && <Studio />}
      {workspace === 'Devices' && <Devices />}
      {workspace === 'Mixer' && <Mixer />}
      {workspace === 'Stream' && <StreamPage />}
      {workspace === 'Library' && <LibraryPage />}
      {workspace === 'Settings' && <SettingsPage />}

      {notice && (
        <div className="toast" role="status">
          <Circle size={9} fill="currentColor" />{notice}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <StudioProvider>
      <Shell />
    </StudioProvider>
  );
}
