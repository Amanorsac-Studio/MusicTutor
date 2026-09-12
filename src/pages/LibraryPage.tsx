import { useCallback, useEffect, useState } from 'react';
import { Clock3, FileVideo, FolderOpen, Library, Music2, Play, Plus, RotateCcw } from 'lucide-react';
import { useStudio } from '../lib/useStudio';
import { formatBytes, formatDateTime } from '../lib/settings';
import type { ProjectSummary, RecordingSummary } from '../types/desktop';

type Tab = 'Projects' | 'Recordings';

export function LibraryPage() {
  const { settings, setNotice, saveProjectFile, openProjectFile, scenes } = useStudio();
  const [tab, setTab] = useState<Tab>('Projects');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [status, setStatus] = useState('Loading library…');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const api = window.pianoTutorDesktop;
    if (!api) {
      setStatus('The library reads files on your PC — available in the installed desktop app.');
      return;
    }
    setBusy(true);
    try {
      const [savedProjects, savedRecordings] = await Promise.all([api.listProjects(), api.listRecordings()]);
      setProjects(savedProjects);
      setRecordings(savedRecordings);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not read the library.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Save the current set-up — every scene, layout and preference. */
  const saveCurrent = async () => {
    const stamp = new Intl.DateTimeFormat(settings.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
    await saveProjectFile(`Lesson ${stamp}`);
    await refresh();
    setTab('Projects');
  };

  const openProject = async (filePath: string) => {
    await openProjectFile(filePath);
  };

  const open = (target: string) => { void window.pianoTutorDesktop?.openPath(target); };
  const isMidi = (name: string) => /\.mid$/i.test(name);

  const empty = !status && ((tab === 'Projects' && !projects.length) || (tab === 'Recordings' && !recordings.length));

  return (
    <div className="workspace-page">
      <header>
        <div>
          <span className="eyebrow">YOUR WORK</span>
          <h1>Library</h1>
          <p>
            A <b>project</b> is your set-up — every scene and layout, saved so you can
            reopen it. A <b>recording</b> is the video and MIDI a lesson produced.
          </p>
        </div>
        <button className="primary small" onClick={() => void saveCurrent()}>
          <Plus />Save current set-up
        </button>
      </header>

      <div className="library-toolbar">
        <div className="tabs">
          <button className={tab === 'Projects' ? 'active' : ''} onClick={() => setTab('Projects')}>
            Projects <b>{projects.length}</b>
          </button>
          <button className={tab === 'Recordings' ? 'active' : ''} onClick={() => setTab('Recordings')}>
            Recordings <b>{recordings.length}</b>
          </button>
        </div>
        <div className="library-actions">
          <button className="subtle-btn" onClick={() => void refresh()} disabled={busy}>
            <RotateCcw />{busy ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            className="subtle-btn"
            onClick={() => void window.pianoTutorDesktop?.openLibraryFolder(tab === 'Projects' ? 'projects' : 'recordings')}
          ><FolderOpen />Open folder</button>
        </div>
      </div>

      <section className="library-explainer">
        <div>
          <FolderOpen />
          <b>Projects — how a lesson is set up</b>
          <p>
            Your scenes, the position of every camera and keyboard in each of them, the
            layouts for landscape, portrait and square, your key, tempo and colours.
            No video. Save one when you have a look you want again next week, then load
            it and everything is where you left it. Teachers usually keep a few: one for
            scales, one for a song lesson, one for a vertical clip.
          </p>
        </div>
        <div>
          <FileVideo />
          <b>Recordings — what a lesson produced</b>
          <p>
            The video file from pressing record, and the MIDI file of what you played
            alongside it. Open one to watch it or drag it into your editor. The MIDI can
            be opened in any notation program to turn a lesson into sheet music.
          </p>
        </div>
        <div>
          <Library />
          <b>Where they live</b>
          <p>
            Both sit in folders on this PC, under your Videos and Documents. Open folder
            takes you there, so you can back them up, rename them or send one to someone.
            Nothing is uploaded anywhere.
          </p>
        </div>
      </section>

      {status && <div className="library-status">{status}</div>}

      {tab === 'Projects' ? (
        <div className="project-grid">
          {projects.map((project, index) => (
            <article className="project-tile" key={project.filePath}>
              <div className={`project-cover cover-${index % 3}`}>
                <span className="mini-keys" />
                <button
                  aria-label={`Open ${project.name}`}
                  title="Load these scenes into the studio"
                  onClick={() => void openProject(project.filePath)}
                ><FolderOpen /></button>
                <small>SET-UP</small>
              </div>
              <div>
                <b>{project.name}</b>
                <p>{formatDateTime(project.savedAt, settings.locale)} · {project.scene}</p>
                <span>Click to load</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="recent-list recording-list">
          <div className="card-title">
            <div><Clock3 /><span><b>Lesson recordings</b><small>Video and MIDI captures in your PianoTutor folder</small></span></div>
          </div>
          {recordings.map(recording => (
            <div className="export-row" key={recording.filePath}>
              {isMidi(recording.name) ? <Music2 /> : <FileVideo />}
              <span>
                <b>{recording.name}</b>
                <small>
                  {formatBytes(recording.size, settings.locale)} · {isMidi(recording.name) ? 'Standard MIDI File' : 'Video recording'}
                </small>
              </span>
              <span>{formatDateTime(recording.createdAt, settings.locale)}</span>
              <button aria-label={`Open ${recording.name}`} onClick={() => open(recording.filePath)}><Play /></button>
            </div>
          ))}
        </section>
      )}

      {empty && (
        <div className="empty-library">
          <Library size={34} />
          <b>No {tab.toLowerCase()} yet</b>
          <small>
            {tab === 'Projects'
              ? `Save your current set-up (${scenes.length} scene${scenes.length === 1 ? '' : 's'}) to reopen it later.`
              : 'Record a lesson in the Tutorial workspace and it will appear here.'}
          </small>
        </div>
      )}
    </div>
  );
}
