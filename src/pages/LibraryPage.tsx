import { useCallback, useEffect, useState } from 'react';
import {
  Check, Clock3, FileVideo, FolderOpen, GraduationCap, Library, Music2, Pencil, Play, Plus, RotateCcw, Share2, Trash2, X,
} from 'lucide-react';
import { useStudio } from '../lib/useStudio';
import { formatBytes, formatDateTime } from '../lib/settings';
import type { ProjectSummary, RecordingSummary } from '../types/desktop';

type Tab = 'Projects' | 'Recordings';

export function LibraryPage({ onStudy }: { onStudy?: (videoPath: string) => void }) {
  const {
    settings, setNotice, saveProjectFile, openProjectFile, scenes,
    openProject, updateProject, projectDirty,
  } = useStudio();
  const [tab, setTab] = useState<Tab>('Projects');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [status, setStatus] = useState('Loading library…');
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

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

  /**
   * Save the current set-up under a name the user chooses.
   *
   * The field opens with a dated suggestion so pressing Enter still works, but
   * a project you cannot name is a project you cannot find again next term.
   */
  const suggestedName = () => {
    const stamp = new Intl.DateTimeFormat(settings.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
    return `Lesson ${stamp}`;
  };

  const saveCurrent = async () => {
    const name = draftName.trim();
    if (!name) return;
    await saveProjectFile(name);
    setNaming(false);
    await refresh();
    setTab('Projects');
  };

  /** Rename a saved project, on disk and in its own contents. */
  const commitRename = async (filePath: string) => {
    const name = renameDraft.trim();
    if (!name) { setRenaming(null); return; }
    try {
      await window.pianoTutorDesktop?.renameProject?.(filePath, name);
      setNotice(`Renamed to “${name}”`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That project could not be renamed.');
    }
    setRenaming(null);
    await refresh();
  };

  /**
   * Delete a file for good, once the user has confirmed on the card itself.
   *
   * There is no undo and no recycle bin here, so the confirmation is a second
   * deliberate click rather than a dialog that is dismissed by reflex.
   */
  const remove = async (filePath: string, kind: 'project' | 'recording') => {
    try {
      if (kind === 'project') await window.pianoTutorDesktop?.deleteProject?.(filePath);
      else await window.pianoTutorDesktop?.deleteRecording?.(filePath);
      setNotice('Deleted.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That file could not be deleted.');
    }
    setConfirming(null);
    await refresh();
  };

  const loadProject = async (filePath: string) => {
    await openProjectFile(filePath);
  };

  const open = (target: string) => { void window.pianoTutorDesktop?.openPath(target); };

  /** Pack a recording with its MIDI into one file that can be sent to a student. */
  const share = async (videoPath: string) => {
    try {
      const result = await window.pianoTutorDesktop?.shareLesson?.(videoPath);
      if (!result) return;
      setNotice(result.withMidi
        ? 'Lesson saved. Send that one file to your student.'
        : 'Lesson saved, but this recording has no MIDI with it. The student will get the video only.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That lesson could not be saved.');
    }
  };
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
        {openProject && !naming ? (
          <span className="save-actions">
            <button
              className="primary small"
              onClick={() => void updateProject().then(() => refresh())}
              disabled={!projectDirty}
            >
              <Check size={14} />
              {projectDirty ? `Update “${openProject.name}”` : 'No changes to save'}
            </button>
            <button
              className="subtle-btn"
              onClick={() => { setDraftName(suggestedName()); setNaming(true); }}
            ><Plus size={13} />Save as new</button>
          </span>
        ) : naming ? (
          <span className="name-field">
            <input
              aria-label="Project name"
              autoFocus
              value={draftName}
              onChange={event => setDraftName(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') void saveCurrent();
                if (event.key === 'Escape') setNaming(false);
              }}
            />
            <button className="primary small" onClick={() => void saveCurrent()} disabled={!draftName.trim()}>
              <Check size={14} />Save
            </button>
            <button className="subtle-btn" onClick={() => setNaming(false)}><X size={14} />Cancel</button>
          </span>
        ) : (
          <button
            className="primary small"
            onClick={() => { setDraftName(suggestedName()); setNaming(true); }}
          ><Plus />Save current set-up</button>
        )}
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
                  onClick={() => void loadProject(project.filePath)}
                ><FolderOpen /></button>
                <small>SET-UP</small>
              </div>
              <div>
                {renaming === project.filePath ? (
                  <span className="name-field inline">
                    <input
                      aria-label={`Rename ${project.name}`}
                      autoFocus
                      value={renameDraft}
                      onChange={event => setRenameDraft(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') void commitRename(project.filePath);
                        if (event.key === 'Escape') setRenaming(null);
                      }}
                    />
                    <button aria-label="Save name" onClick={() => void commitRename(project.filePath)}><Check size={13} /></button>
                    <button aria-label="Cancel rename" onClick={() => setRenaming(null)}><X size={13} /></button>
                  </span>
                ) : (
                  <b>{project.name}</b>
                )}
                <p>{formatDateTime(project.savedAt, settings.locale)} · {project.scene}</p>
                <div className="tile-actions">
                  <button
                    onClick={() => { setRenameDraft(project.name); setRenaming(project.filePath); }}
                  ><Pencil size={12} />Rename</button>
                  {confirming === project.filePath ? (
                    <>
                      <button className="danger" onClick={() => void remove(project.filePath, 'project')}>
                        <Trash2 size={12} />Delete for good
                      </button>
                      <button onClick={() => setConfirming(null)}>Keep</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirming(project.filePath)}><Trash2 size={12} />Delete</button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="recent-list recording-list">
          <div className="card-title">
            <div><Clock3 /><span><b>Lesson recordings</b><small>Video and MIDI captures in your MusicTutor folder</small></span></div>
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
              <span className="row-actions">
                {!isMidi(recording.name) && (
                  <>
                    <button
                      aria-label={`Share ${recording.name} as a lesson`}
                      title="Share as a lesson: the video and its MIDI in one file"
                      onClick={() => void share(recording.filePath)}
                    ><Share2 size={15} /></button>
                    {onStudy && (
                      <button
                        aria-label={`Study ${recording.name} in Learn`}
                        title="Study it in the Learn tab, the way a student would"
                        onClick={() => onStudy(recording.filePath)}
                      ><GraduationCap size={15} /></button>
                    )}
                  </>
                )}
                <button aria-label={`Open ${recording.name}`} onClick={() => open(recording.filePath)}><Play /></button>
                {confirming === recording.filePath ? (
                  <>
                    <button
                      className="danger"
                      aria-label={`Delete ${recording.name} for good`}
                      onClick={() => void remove(recording.filePath, 'recording')}
                    ><Check size={15} /></button>
                    <button aria-label="Keep it" onClick={() => setConfirming(null)}><X size={15} /></button>
                  </>
                ) : (
                  <button
                    aria-label={`Delete ${recording.name}`}
                    onClick={() => setConfirming(recording.filePath)}
                  ><Trash2 size={15} /></button>
                )}
              </span>
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
