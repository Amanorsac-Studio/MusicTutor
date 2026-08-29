import { useCallback, useEffect, useState } from 'react';
import { Clock3, FileVideo, FolderOpen, Library, Music2, Play, Plus, RotateCcw } from 'lucide-react';
import { useStudio } from '../lib/useStudio';
import { formatBytes, formatDateTime } from '../lib/settings';
import type { ProjectSummary, RecordingSummary } from '../types/desktop';

type Tab = 'Projects' | 'Recordings';

export function LibraryPage() {
  const { settings, setNotice } = useStudio();
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

  const createProject = async () => {
    const api = window.pianoTutorDesktop;
    if (!api) {
      setNotice('Projects are saved by the installed desktop app.');
      return;
    }
    const stamp = new Intl.DateTimeFormat(settings.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
    const filePath = await api.saveProject({
      name: `Untitled Lesson ${stamp}`,
      scene: 'Default Lesson',
      keyRoot: settings.keyRoot,
      mode: settings.mode,
      createdAt: new Date().toISOString(),
    }).catch(() => undefined);
    setNotice(filePath ? `Project created at ${filePath}` : 'Project could not be created');
    await refresh();
    setTab('Projects');
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
          <p>Projects and recordings saved on this PC.</p>
        </div>
        <button className="primary small" onClick={() => void createProject()}><Plus />New project</button>
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

      {status && <div className="library-status">{status}</div>}

      {tab === 'Projects' ? (
        <div className="project-grid">
          {projects.map((project, index) => (
            <article className="project-tile" key={project.filePath}>
              <div className={`project-cover cover-${index % 3}`}>
                <span className="mini-keys" />
                <button aria-label={`Open ${project.name}`} onClick={() => open(project.filePath)}><FolderOpen /></button>
                <small>PROJECT</small>
              </div>
              <div>
                <b>{project.name}</b>
                <p>{formatDateTime(project.savedAt, settings.locale)} · {project.scene}</p>
                <span>Saved locally</span>
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
              ? 'Create your first lesson project.'
              : 'Record a lesson in the Tutorial workspace and it will appear here.'}
          </small>
        </div>
      )}
    </div>
  );
}
