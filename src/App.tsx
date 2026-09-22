import { useEffect, useState } from 'react';
import {
  Circle, GraduationCap, Library, Maximize2, Minus, MonitorPlay, Settings as SettingsIcon,
  Radio, SlidersHorizontal, Upload, Waves, Wifi, X,
} from 'lucide-react';
import { StudioProvider, useStudio } from './lib/useStudio';
import { Studio } from './pages/Studio';
import { Devices } from './pages/Devices';
import { Mixer } from './pages/Mixer';
import { LibraryPage } from './pages/LibraryPage';
import { SettingsPage } from './pages/SettingsPage';
import { StreamPage } from './pages/StreamPage';
import { LearnPage } from './pages/LearnPage';
import { StemsPage } from './pages/StemsPage';
import { learnPlayer, trackPlayer } from './lib/player';
import { learnSession } from './lib/learn';
import { TestBuildGate } from './components/TestBuildGate';
import { formatDuration } from './lib/settings';

type Workspace = 'Studio' | 'Learn' | 'Stems' | 'Devices' | 'Mixer' | 'Stream' | 'Library' | 'Settings';

const WORKSPACES: Array<{ id: Workspace; label: string; Icon: typeof MonitorPlay }> = [
  { id: 'Studio', label: 'Tutorial', Icon: MonitorPlay },
  { id: 'Learn', label: 'Learn', Icon: GraduationCap },
  { id: 'Stems', label: 'Stems', Icon: Waves },
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
      <strong>Music<span>Tutor</span></strong>
    </div>
  );
}

function Shell() {
  const [workspace, setWorkspace] = useState<Workspace>('Studio');
  const {
    recording, elapsedMs, startRecording, stopRecording, notice, setNotice,
    panic, settings, updateSettings,
    openProject, updateProject,
  } = useStudio();

  const desktop = window.pianoTutorDesktop;

  // A lesson file opened from outside the app — double-clicked in a folder, or
  // opened while the app was already running — goes straight to the Learn tab.
  const concertPitch = settings.concertPitch;
  useEffect(() => {
    const bridge = window.pianoTutorDesktop;
    if (!bridge?.onOpenLesson) return;
    const open = (filePath: string) => {
      setWorkspace('Learn');
      void learnSession.openLessonPath(filePath, concertPitch);
    };
    void bridge.takePendingLesson?.().then(filePath => { if (filePath) open(filePath); });
    return bridge.onOpenLesson(open);
  }, [concertPitch]);

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
        // Space starts and stops the backing track, the way it does in every
        // other player. It has to preventDefault or it also scrolls the page
        // and re-triggers whichever button was last clicked.
        if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          // Whichever player belongs to the tab in front.
          const target = workspace === 'Learn' ? learnPlayer : trackPlayer;
          const player = target.state;
          if (!player.track) {
            setNotice(workspace === 'Learn' ? 'Import a song first, then space plays it.' : 'Import a track first, then space plays it.');
          } else if (player.playing) target.pause();
          else target.play();
          return;
        }
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
        // Update what is open; with nothing open, the Library is where a name
        // is chosen, so go there rather than inventing one.
        if (openProject) void updateProject();
        else {
          setWorkspace('Library');
          setNotice('Name the project to save it.');
        }
      } else if (key >= '1' && key <= String(WORKSPACES.length)) {
        event.preventDefault();
        setWorkspace(WORKSPACES[Number(key) - 1].id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [recording, startRecording, stopRecording, panic, setNotice, workspace, settings.computerKeyOctave, updateSettings, openProject, updateProject]);

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

      {workspace === 'Studio' && <Studio onOpenStream={() => setWorkspace('Stream')} />}
      {workspace === 'Learn' && <LearnPage />}
      {workspace === 'Stems' && <StemsPage />}
      {workspace === 'Devices' && <Devices />}
      {workspace === 'Mixer' && <Mixer />}
      {workspace === 'Stream' && <StreamPage />}
      {workspace === 'Library' && (
        <LibraryPage
          onStudy={path => {
            setWorkspace('Learn');
            void learnSession.openRecording(path, settings.concertPitch);
          }}
        />
      )}
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
    <TestBuildGate>
      <StudioProvider>
        <Shell />
      </StudioProvider>
    </TestBuildGate>
  );
}
