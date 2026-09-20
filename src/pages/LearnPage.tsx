/**
 * The Learn tab: working a song out by ear, with help.
 *
 * Two ways in. An imported song or video is heard ahead of time — its chords
 * named, its notes laid on a piano roll, its instruments pulled apart — and can
 * then be looped, slowed and transposed like any practice tool. YouTube is
 * listened to as it plays, since there is no file to study, and the chord being
 * played is named and shown on the keys a moment behind the music.
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Circle, Disc, Ear, FileAudio, Home, Minus, Pause, Play, Plus, Repeat, RotateCw,
  Scissors, Square, Trash2, Tv, Upload, Volume2, VolumeX,
} from 'lucide-react';
import { useStudio } from '../lib/useStudio';
import { audioEngine } from '../lib/audioEngine';
import { learnPlayer } from '../lib/player';
import { startCapture, type CaptureHandle } from '../lib/recordCapture';
import {
  learnSession, STEM_LABELS, STEM_NAMES, VIEW_LABELS, type NoteView,
} from '../lib/learn';
import { liveListener } from '../lib/liveListen';
import {
  chordAt, chordLabel, chordVoicing, keyPrefersFlats, CHORD_SHAPES, type ChordQuality,
} from '../lib/chordTrack';
import { GUITAR_STRINGS, guitarShape, shapeReach } from '../lib/guitar';
import { labelNote, labelNotes, type NoteLabelMode } from '../lib/solfa';
import { noteName } from '../lib/chords';
import { notesAt, usedRange } from '../lib/transcribe';
import { BASS_TUNINGS, likelyPosition, positionsFor, type FretPosition } from '../lib/fretboard';
import { drawFretboard } from '../lib/drawFretboard';
import { PianoRoll } from '../components/PianoRoll';
import { PianoKeyboard, KEY_RANGES } from '../components/PianoKeyboard';
import { Waveform } from '../components/Waveform';

const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1];
const LOOP_BARS = [1, 2, 4, 8];
const YOUTUBE_HOME = 'https://www.youtube.com/';

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Subscribe to one of the stores that live outside React. */
function useStore<T>(store: { state: T; subscribe: (listener: () => void) => () => void }): T {
  const [state, setState] = useState(store.state);
  useEffect(() => {
    setState(store.state);
    return store.subscribe(() => setState(store.state));
  }, [store]);
  return state;
}

/**
 * What the screen shows runs this far ahead of the sound. Drawing takes a
 * moment and eyes take longer; a chord named exactly on time is read late.
 */
const DISPLAY_LEAD = 0.08;

const NOTE_MODES: Array<{ id: NoteLabelMode; label: string }> = [
  { id: 'names', label: 'Names' },
  { id: 'solfa', label: 'Solfa' },
  { id: 'numbers', label: '1 2 3' },
];

const VIEWS: NoteView[] = ['mix', 'bass', 'keys', 'guitar', 'vocals'];

/** The notes sounding now, large, as names, solfa or scale numbers. */
function NoteReadout({
  midi, mode, onMode, keyRoot, keyMode, accidental, caption,
}: {
  midi: number[];
  mode: NoteLabelMode;
  onMode: (mode: NoteLabelMode) => void;
  keyRoot: number;
  keyMode: 'major' | 'minor';
  accidental: 'sharp' | 'flat';
  caption: string;
}) {
  const labels = labelNotes(midi, mode, { keyRoot, mode: keyMode, accidental });
  const text = labels.join('  ');
  // Shrinks as the chord fills up, so one bass note is huge and six still fit.
  const size = text.length <= 3 ? 58 : text.length <= 8 ? 44 : text.length <= 14 ? 32 : 24;
  return (
    <div className="learn-notes">
      <div className="learn-notes-head">
        <small>{caption}</small>
        <div className="learn-note-modes">
          {NOTE_MODES.map(item => (
            <button key={item.id} className={mode === item.id ? 'active' : ''} onClick={() => onMode(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <strong style={{ fontSize: size }} data-notes={midi.join(',')}>{text || '—'}</strong>
    </div>
  );
}

/** Keep a canvas drawn at the size it is shown, or its lettering stretches. */
function useCanvasSize(ref: React.RefObject<HTMLCanvasElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const measure = () => setSize({ width: canvas.clientWidth, height: canvas.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** A chord as a guitarist sees it: the shape under the hand. */
function GuitarNeck({
  chord, title, label,
}: {
  chord: { root: number; quality: ChordQuality } | null;
  title: string;
  label: (midi: number) => string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(ref);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !size.width || !size.height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const shape = chord ? guitarShape(chord.root, chord.quality) : null;
    drawFretboard(ctx, { width: canvas.width, height: canvas.height }, {
      tuning: { strings: GUITAR_STRINGS },
      midi: null, position: null,
      frets: shape ? Math.max(12, shapeReach(shape)) : 12,
      keyRoot: 0, accidental: 'sharp', accent: '#ffa629', background: 'transparent',
      showReadout: true,
      title: chord ? title : '—',
      marks: shape
        ? shape.flatMap((fret, string) => (fret < 0 ? [] : [{
          string, fret,
          label: label(GUITAR_STRINGS[string] + fret),
          root: (GUITAR_STRINGS[string] + fret) % 12 === chord?.root,
        }]))
        : [],
      muted: shape ? shape.flatMap((fret, string) => (fret < 0 ? [string] : [])) : [],
    });
  }, [chord, title, label, size]);

  return <canvas className="learn-neck" ref={ref} />;
}

/** The bass neck, following the notes heard in the bass stem. */
function LearnFretboard({ midi, keyRoot }: { midi: number | null; keyRoot: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef<FretPosition | null>(null);
  const { settings } = useStudio();
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Drawn at the size it is shown, or the note names come out stretched.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const measure = () => setSize({ width: canvas.clientWidth, height: canvas.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !size.width || !size.height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const tuning = BASS_TUNINGS[settings.bassTuning];
    const frets = Math.max(settings.bassFrets, 15);
    const position = midi === null ? null : likelyPosition(positionsFor(midi, tuning, frets), last.current);
    if (position) last.current = position;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFretboard(ctx, { width: canvas.width, height: canvas.height }, {
      tuning, midi, position, frets,
      keyRoot,
      accidental: settings.accidental,
      accent: '#ffa629',
      background: 'transparent',
      showReadout: true,
    });
  }, [midi, size, settings.bassTuning, settings.bassFrets, keyRoot, settings.accidental]);

  return <canvas className="learn-neck" ref={ref} />;
}

/* ------------------------------------------------------------------ *
 * An imported song
 * ------------------------------------------------------------------ */

function SongView() {
  const { settings, activeNotes, noteOn, noteOff, setNotice } = useStudio();
  const session = useStore(learnSession);
  const player = useStore(learnPlayer);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [show, setShow] = useState<'notes' | 'chord'>('notes');
  const [noteMode, setNoteMode] = useState<NoteLabelMode>('names');
  const [sounding, setSounding] = useState<number[]>([]);
  const [chordIndex, setChordIndex] = useState(-1);
  const [position, setPosition] = useState(0);

  const { track } = player;
  const transpose = player.semitones;
  const getPosition = useCallback(() => learnPlayer.position, []);

  // What is sounding now, and which chord. Checked often, but state only moves
  // when the answer changes, so the page is not re-rendered sixty times a second.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = learnPlayer.position + (learnPlayer.state.playing ? DISPLAY_LEAD : 0);
      const midi = notesAt(session.notes, now).map(note => note.midi).sort((a, b) => a - b);
      setSounding(before => (before.length === midi.length && before.every((m, i) => m === midi[i]) ? before : midi));
      const chord = chordAt(session.chords, now);
      setChordIndex(chord ? session.chords.indexOf(chord) : -1);
      setPosition(before => (Math.abs(before - now) > 0.09 ? now : before));
    }, 50);
    return () => window.clearInterval(id);
  }, [session.notes, session.chords]);

  // The picture follows the sound. The player owns the clock, because it is the
  // one that loops, slows down and transposes; the video is only ever corrected.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !session.videoUrl) return;
    const id = window.setInterval(() => {
      const target = learnPlayer.position;
      const state = learnPlayer.state;
      video.playbackRate = Math.max(0.25, Math.min(2, state.speed));
      if (Math.abs(video.currentTime - target) > 0.2) video.currentTime = target;
      if (state.playing && video.paused) void video.play().catch(() => { /* not ready yet */ });
      if (!state.playing && !video.paused) video.pause();
    }, 120);
    return () => window.clearInterval(id);
  }, [session.videoUrl]);

  const chord = chordIndex >= 0 ? session.chords[chordIndex] : null;
  const nextChord = useMemo(() => {
    for (let i = chordIndex + 1; i < session.chords.length; i += 1) {
      const item = session.chords[i];
      if (item.root >= 0 && (item.root !== chord?.root || item.quality !== chord?.quality)) return item;
    }
    return null;
  }, [chordIndex, session.chords, chord]);

  const range = useMemo(() => {
    const used = usedRange(session.notes);
    return { low: Math.max(21, used.low + Math.min(0, transpose)), high: Math.min(108, used.high + Math.max(0, transpose)) };
  }, [session.notes, transpose]);

  const lit = useMemo(() => {
    const set = new Set(activeNotes);
    if (show === 'chord' && chord?.quality) chordVoicing(chord.root, chord.quality, transpose).forEach(m => set.add(m));
    else sounding.forEach(m => set.add(m + transpose));
    return set;
  }, [activeNotes, show, chord, sounding, transpose]);

  const chordTones = chord?.quality
    ? CHORD_SHAPES[chord.quality].map(interval => (((chord.root + interval + transpose) % 12) + 12) % 12)
    : undefined;

  const onFiles = (files: File[]) => {
    if (files.length) void learnSession.openFiles(files, settings.concertPitch);
  };

  const bassLine = session.view === 'bass';
  const busy = Boolean(session.working);
  const stems = session.stems;
  const stemsReady = stems.phase === 'ready';
  const splitting = stems.phase === 'downloading' || stems.phase === 'separating' || stems.phase === 'loading';
  // The key moves with the transposition, or solfa would name the wrong do.
  const keyRoot = (((session.key.root + transpose) % 12) + 12) % 12;
  const allAudible = STEM_NAMES.every(stem => session.audible[stem]);
  // A song in D♭ is written in flats whatever the rest of the app is set to.
  const spelling = keyPrefersFlats({ root: keyRoot, mode: session.key.mode }) ? 'flat' : 'sharp';
  const waitingForNotes = !session.detected.includes(session.view);

  return (
    <div className="learn-song">
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="audio/*,video/*,.mid,.midi,.musictutor-lesson"
        aria-label="Import a song or video"
        style={{ display: 'none' }}
        onChange={event => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />

      {!track && !busy && (
        <div
          className="learn-empty"
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault();
            onFiles(Array.from(event.dataTransfer.files ?? []));
          }}
        >
          <FileAudio size={34} />
          <h2>Import a song to learn it</h2>
          <p>
            Drop an audio or video file here. The chords are named, the notes are
            laid out on a piano roll, and you can loop, slow down and transpose
            any part of it. Everything is worked out on this computer.
          </p>
          <p>
            Got a lesson from your teacher? Drop that here too — a lesson file, or a
            recording together with its MIDI. Then the notes on the roll are the ones
            that were actually played.
          </p>
          <button className="primary small" onClick={() => fileRef.current?.click()}>
            <Upload size={14} />Open a song, video or lesson
          </button>
          {session.error && <div className="page-banner error">{session.error}</div>}

          {session.library.length > 0 && (
            <div className="learn-library">
              <small>Songs you&apos;ve separated</small>
              <div className="learn-library-list">
                {session.library.map(entry => (
                  <div key={entry.id} className="learn-library-item">
                    <button className="learn-library-open" onClick={() => void learnSession.openFromLibrary(entry)}>
                      <span>
                        <b>{entry.name}</b>
                        <small>
                          {formatTime(entry.duration)} · {noteName(60 + entry.key.root, 'sharp')} {entry.key.mode}
                        </small>
                      </span>
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`Forget ${entry.name}`}
                      onClick={() => void learnSession.deleteFromLibrary(entry.id)}
                    ><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!track && busy && (
        <div className="learn-empty">
          <Ear size={34} />
          <h2>{session.working}…</h2>
        </div>
      )}

      {track && (
        <div className="learn-grid">
          <section className="learn-main">
            <div className="learn-top">
              {session.videoUrl && (
                <video ref={videoRef} className="learn-video" src={session.videoUrl} muted playsInline />
              )}
              <div className="learn-chord" aria-live="off">
                <small>
                  Chord now{session.exact ? " · from the lesson's MIDI" : session.chordsFromStems ? ' · from bass and keys' : ''}
                </small>
                <strong>{chord ? chordLabel(chord, spelling, transpose) : '—'}</strong>
                <span>{nextChord ? `Next: ${chordLabel(nextChord, spelling, transpose)}` : ' '}</span>
              </div>
              <div className="learn-status">
                <b title={session.fileName}>{session.fileName}</b>
                <small>
                  {player.bpm.toFixed(1)} BPM
                  {transpose !== 0 && ` · ${transpose > 0 ? '+' : ''}${transpose} semitones`}
                  {player.speed !== 1 && ` · ${Math.round(player.speed * 100)}% speed`}
                </small>
                {busy && (
                  <div className="learn-progress" role="status">
                    <span>{session.working}…</span>
                    <i><em style={{ width: `${Math.round(session.progress * 100)}%` }} /></i>
                  </div>
                )}
                {session.exact && (
                  <small className="learn-exact">
                    Exact notes — played, not guessed. The chords are read from them.
                  </small>
                )}
                {!busy && !waitingForNotes && !session.notes.length && (
                  <small className="learn-quiet">No clear notes were heard in this part.</small>
                )}
                {session.error && <div className="page-banner error">{session.error}</div>}
              </div>
              <NoteReadout
                midi={sounding.map(m => m + transpose)}
                mode={noteMode}
                onMode={setNoteMode}
                keyRoot={keyRoot}
                keyMode={session.key.mode}
                accidental={spelling}
                caption={`${VIEW_LABELS[session.view]} · notes now`}
              />
            </div>

            <PianoRoll
              notes={session.notes}
              chords={session.chords}
              grid={track.grid}
              range={range}
              accidental={spelling}
              transpose={transpose}
              getPosition={getPosition}
              loop={player.looping ? player.loop : null}
              onSeek={time => learnPlayer.seek(time)}
            />

            <div className={`learn-instrument ${bassLine ? 'neck' : ''}`}>
              {bassLine ? (
                <LearnFretboard midi={sounding.length ? sounding[0] + transpose : null} keyRoot={keyRoot} />
              ) : (
                <PianoKeyboard
                  active={lit}
                  onNoteOn={noteOn}
                  onNoteOff={noteOff}
                  range={KEY_RANGES['88']}
                  accidental={spelling}
                  accent="#ffa629"
                  namePlayed
                  fill
                  highlightPitchClasses={chordTones}
                />
              )}
            </div>

            <Waveform
              peaks={track.peaks}
              duration={track.duration}
              position={position}
              loop={player.loop}
              grid={track.grid}
              snap={(time, toBar) => learnPlayer.snap(time, toBar)}
              onSeek={time => learnPlayer.seek(time)}
              onLoop={loopRange => learnPlayer.setLoop(loopRange)}
            />

            <div className="learn-transport">
              <div className="track-transport">
                <button
                  className="track-play"
                  aria-label={player.playing ? 'Pause' : 'Play'}
                  onClick={() => (player.playing ? learnPlayer.pause() : learnPlayer.play())}
                >{player.playing ? <Pause size={17} /> : <Play size={17} />}</button>
                <button aria-label="Stop" onClick={() => learnPlayer.stop()}><Square size={13} /></button>
                <button
                  aria-label="Loop"
                  aria-pressed={player.looping}
                  className={player.looping ? 'on' : ''}
                  onClick={() => learnPlayer.setLooping(!player.looping)}
                ><Repeat size={14} /></button>
              </div>
              <span className="learn-time">{formatTime(position)} / {formatTime(track.duration)}</span>

              <div className="learn-group">
                <small>Loop bars</small>
                {LOOP_BARS.map(bars => (
                  <button key={bars} onClick={() => learnPlayer.loopBars(learnPlayer.position, bars)}>{bars}</button>
                ))}
                <button onClick={() => learnPlayer.setLoop(null)} disabled={!player.loop}>Clear</button>
              </div>

              <div className="learn-group">
                <small>Speed</small>
                {SPEEDS.map(speed => (
                  <button
                    key={speed}
                    className={Math.abs(player.speed - speed) < 0.001 ? 'active' : ''}
                    onClick={() => learnPlayer.setSpeed(speed)}
                  >{Math.round(speed * 100)}%</button>
                ))}
              </div>

              <div className="learn-group">
                <small>Key</small>
                <button aria-label="Down a semitone" onClick={() => learnPlayer.transposeBy(-1)}><Minus size={12} /></button>
                <b className="learn-value">{transpose > 0 ? `+${transpose}` : transpose}</b>
                <button aria-label="Up a semitone" onClick={() => learnPlayer.transposeBy(1)}><Plus size={12} /></button>
              </div>

              <label className="learn-group learn-volume">
                <Volume2 size={13} />
                <input
                  type="range" min={0} max={1} step={0.01} value={player.volume}
                  aria-label="Song volume"
                  onChange={event => learnPlayer.setVolume(Number(event.target.value))}
                />
              </label>
              {player.rendering && (
                <span className="learn-rendering">Preparing… {Math.round(player.renderProgress * 100)}%</span>
              )}
            </div>
          </section>

          <aside className="learn-side">
            <div className="inspector-title"><span>Show on the keys</span></div>
            <div className="panel-tabs">
              <button className={show === 'notes' ? 'active' : ''} onClick={() => setShow('notes')}>Notes heard</button>
              <button className={show === 'chord' ? 'active' : ''} onClick={() => setShow('chord')}>Chord shape</button>
            </div>
            <p className="panel-hint">
              The orange bars on the roll are the tune. Keys marked with a dot belong to the chord being played.
            </p>

            <div className="learn-keyrow">
              <small>Song key</small>
              <select
                aria-label="Song key"
                value={`${session.key.root}:${session.key.mode}`}
                onChange={event => {
                  const [root, mode] = event.target.value.split(':');
                  learnSession.setKey({ root: Number(root), mode: mode === 'minor' ? 'minor' : 'major' });
                }}
              >
                {(['major', 'minor'] as const).flatMap(mode => Array.from({ length: 12 }, (_, root) => (
                  <option key={`${root}:${mode}`} value={`${root}:${mode}`}>
                    {noteName(60 + root, settings.accidental)} {mode}
                  </option>
                )))}
              </select>
            </div>

            <hr />
            <div className="inspector-title"><span>Notes on the roll</span></div>
            <div className="learn-views">
              {VIEWS.map(view => {
                const found = session.detected.includes(view);
                return (
                  <button
                    key={view}
                    className={session.view === view ? 'active' : ''}
                    disabled={view !== 'mix' && !stemsReady}
                    title={found ? 'Show these notes' : 'Find and show these notes'}
                    onClick={() => learnSession.showNotes(view)}
                  >
                    {VIEW_LABELS[view]}
                    {!found && (view === 'mix' || stemsReady) && <em>detect</em>}
                  </button>
                );
              })}
            </div>
            {stemsReady && (
              <p className="panel-hint">
                Bass and keys are read for you. The others are read when you pick them.
                Keys are heard together with "other", where pads and organs end up.
              </p>
            )}

            <hr />
            <div className="inspector-title"><span>Play along</span><Scissors size={15} /></div>

            {stems.phase === 'none' && (
              <>
                <p className="panel-hint">
                  Split the song into bass, keys, guitar, vocals and drums. Then mute the part you are
                  learning and play it yourself with the rest of the band. The chords are also heard again
                  from the bass and keys alone, which is more accurate. It takes a few minutes, once per song.
                </p>
                <button className="primary small wide" onClick={() => void learnSession.separate()}>
                  <Scissors size={14} />Separate the instruments
                </button>
              </>
            )}
            {splitting && (
              <div className="learn-progress" role="status">
                <span>
                  {stems.phase === 'downloading'
                    ? `Downloading the model… ${Math.round(stems.progress * 100)}%`
                    : stems.phase === 'loading'
                      ? 'Opening the instruments…'
                      : stems.progress > 0
                        ? `Separating… ${Math.round(stems.progress * 100)}%`
                        : 'Getting ready. This first step takes half a minute…'}
                </span>
                <i><em style={{ width: `${Math.round(stems.progress * 100)}%` }} /></i>
                {stems.phase === 'separating' && (
                  <button className="subtle-btn" onClick={() => learnSession.cancelSeparation()}>Cancel</button>
                )}
              </div>
            )}
            {stems.error && <div className="page-banner error">{stems.error}</div>}

            {stemsReady && (
              <>
                <div className="learn-mixer">
                  {STEM_NAMES.map(stem => (
                    <div key={stem} className={`learn-stem ${session.audible[stem] ? '' : 'muted'}`}>
                      <button
                        className="learn-mute"
                        aria-pressed={!session.audible[stem]}
                        aria-label={`${session.audible[stem] ? 'Mute' : 'Unmute'} ${STEM_LABELS[stem]}`}
                        onClick={() => learnSession.toggle(stem)}
                      >{session.audible[stem] ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>
                      <span>{STEM_LABELS[stem]}</span>
                      <button className="learn-solo" onClick={() => learnSession.solo(stem)}>Solo</button>
                    </div>
                  ))}
                </div>
                <button className="subtle-btn" onClick={() => learnSession.everyone()} disabled={allAudible}>
                  Bring everyone back
                </button>
              </>
            )}

            <hr />
            <button className="subtle-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={13} />Import another
            </button>
            <button
              className="subtle-btn"
              onClick={() => { learnSession.close(); setNotice('Song closed.'); }}
            ><Trash2 size={13} />Close this song</button>
          </aside>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * YouTube
 * ------------------------------------------------------------------ */

type WebviewElement = HTMLElement & {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  loadURL: (url: string) => Promise<void>;
  getURL: () => string;
};

function YouTubeView({ onRecorded }: { onRecorded: () => void }) {
  const { settings, activeNotes, noteOn, noteOff } = useStudio();
  const live = useStore(liveListener);
  const holder = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState(YOUTUBE_HOME);
  const [noteMode, setNoteMode] = useState<NoteLabelMode>('names');
  const [instrument, setInstrument] = useState<'keys' | 'bass' | 'guitar'>('keys');
  const isDesktop = Boolean(window.pianoTutorDesktop?.isDesktop);

  // Recording is kept apart from the live listener: this captures the sound
  // itself, to be analysed properly once it stops, rather than named as it goes.
  const capture = useRef<CaptureHandle | null>(null);
  const [recordState, setRecordState] = useState<'idle' | 'recording' | 'working'>('idle');
  const [recordError, setRecordError] = useState('');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (recordState !== 'recording') return;
    const started = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [recordState]);

  // Leaving the tab mid-recording should not leave the microphone-style
  // sharing indicator running for a capture nobody will ever stop.
  useEffect(() => () => { void capture.current?.stop(); }, []);

  const startRecording = async () => {
    setRecordError('');
    try {
      capture.current = await startCapture();
      setRecordState('recording');
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : "The computer's sound could not be captured.");
    }
  };

  const stopRecording = async () => {
    const handle = capture.current;
    capture.current = null;
    if (!handle) return;
    setRecordState('working');
    try {
      const blob = await handle.stop();
      const bytes = await blob.arrayBuffer();
      const buffer = await audioEngine.ensure().decodeAudioData(bytes);
      // Two things playing at once helps nobody hear either.
      liveListener.stop();
      await learnSession.openFromBuffer(buffer, 'Recorded from YouTube', settings.concertPitch);
      onRecorded();
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : 'That recording could not be analysed.');
    } finally {
      setRecordState('idle');
    }
  };

  const view = () => holder.current?.querySelector('webview') as WebviewElement | null;

  useEffect(() => {
    const element = view();
    if (!element) return;
    const update = () => { try { setAddress(element.getURL()); } catch { /* not attached yet */ } };
    element.addEventListener('did-navigate', update);
    element.addEventListener('did-navigate-in-page', update);
    return () => {
      element.removeEventListener('did-navigate', update);
      element.removeEventListener('did-navigate-in-page', update);
    };
  }, []);

  // Listening belongs to this view; leaving it lets go of the computer's sound.
  useEffect(() => () => liveListener.stop(), []);

  const { chord, bassNote } = live;
  const naming = useMemo(
    () => ({ keyRoot: settings.keyRoot, mode: settings.mode, accidental: settings.accidental }),
    [settings.keyRoot, settings.mode, settings.accidental],
  );
  const label = useCallback((midi: number) => labelNote(midi, noteMode, naming), [noteMode, naming]);

  // One answer, drawn three ways. The keys, the necks and the readout all show
  // this chord, so what is seen always agrees with the name beside it.
  const voicing = useMemo(() => {
    if (!chord) return [];
    const notes = chordVoicing(chord.root, chord.quality);
    if (chord.bass !== undefined) notes[0] = 36 + chord.bass;
    return notes;
  }, [chord]);
  const lit = useMemo(() => new Set([...activeNotes, ...voicing]), [activeNotes, voicing]);

  // The bass as heard; failing that, the chord's own bass note, which is what
  // a bass player would reach for anyway.
  const bassMidi = bassNote ?? (chord ? 28 + (((chord.bass ?? chord.root) - 4 + 12) % 12) : null);
  const chordName = chord ? chordLabel(chord, settings.accidental) : '—';

  if (!isDesktop) {
    return (
      <div className="learn-empty">
        <Tv size={34} />
        <h2>YouTube opens in the desktop app</h2>
        <p>The browser and live listening need the installed app.</p>
      </div>
    );
  }

  return (
    <div className="learn-tube">
      <div className="learn-browser">
        <div className="learn-address">
          <button aria-label="Back" onClick={() => view()?.goBack()}><ArrowLeft size={14} /></button>
          <button aria-label="Forward" onClick={() => view()?.goForward()}><ArrowRight size={14} /></button>
          <button aria-label="Reload" onClick={() => view()?.reload()}><RotateCw size={13} /></button>
          <button aria-label="YouTube home" onClick={() => void view()?.loadURL(YOUTUBE_HOME)}><Home size={13} /></button>
          <span title={address}>{address}</span>
          {recordState === 'idle' && (
            <button
              className="learn-record-btn"
              title="Record the video's sound, then hear its chords and notes the thorough way — the same analysis an imported song gets, not a live guess"
              onClick={() => void startRecording()}
            ><Disc size={13} />Record &amp; analyse</button>
          )}
          {recordState === 'recording' && (
            <button className="learn-record-btn recording" onClick={() => void stopRecording()}>
              <Circle size={9} fill="currentColor" />{formatTime(elapsed)} · Stop
            </button>
          )}
          {recordState === 'working' && <span className="learn-record-working">Analysing…</span>}
        </div>
        {recordError && <div className="page-banner error learn-record-error">{recordError}</div>}
        <div className="learn-webview" ref={holder}>
          {createElement('webview', {
            src: YOUTUBE_HOME,
            partition: 'persist:learn-youtube',
            style: { width: '100%', height: '100%' },
          })}
        </div>
      </div>

      <div className="learn-live">
        <div className="learn-live-top">
          <div className="learn-chord">
            <small>{live.listening ? 'Chord now' : 'Not listening'}</small>
            <strong>{chordName}</strong>
            <span>&nbsp;</span>
          </div>
          <div className="learn-live-side">
            <button
              className={`primary small ${live.listening ? 'listening' : ''}`}
              onClick={() => (live.listening ? liveListener.stop() : void liveListener.start(settings.concertPitch))}
            ><Ear size={14} />{live.listening ? 'Stop listening' : 'Listen and name the chords'}</button>
            <div className="panel-tabs learn-instruments" role="group" aria-label="Show on">
              {(['keys', 'bass', 'guitar'] as const).map(item => (
                <button key={item} className={instrument === item ? 'active' : ''} onClick={() => setInstrument(item)}>
                  {item === 'keys' ? 'Keys' : item === 'bass' ? 'Bass' : 'Guitar'}
                </button>
              ))}
            </div>
            {live.error && <div className="page-banner error">{live.error}</div>}
          </div>
          <NoteReadout
            midi={instrument === 'bass' ? (bassMidi === null ? [] : [bassMidi]) : voicing}
            mode={noteMode}
            onMode={setNoteMode}
            keyRoot={settings.keyRoot}
            keyMode={settings.mode}
            accidental={settings.accidental}
            caption={instrument === 'bass' ? 'Bass note now' : 'Notes of the chord'}
          />
        </div>
        <div className={`learn-instrument ${instrument === 'keys' ? '' : 'neck'}`}>
          {instrument === 'keys' && (
            <PianoKeyboard
              active={lit}
              onNoteOn={noteOn}
              onNoteOff={noteOff}
              range={KEY_RANGES['61']}
              accidental={settings.accidental}
              accent="#ffa629"
              namePlayed
              fill
            />
          )}
          {instrument === 'bass' && <LearnFretboard midi={bassMidi} keyRoot={settings.keyRoot} />}
          {instrument === 'guitar' && <GuitarNeck chord={chord} title={chordName} label={label} />}
        </div>
      </div>
    </div>
  );
}

export function LearnPage() {
  const [mode, setModeState] = useState<'song' | 'youtube'>('song');
  const setMode = (next: 'song' | 'youtube') => {
    // Two things playing at once helps nobody hear either.
    if (next === 'youtube') learnPlayer.pause();
    setModeState(next);
  };
  return (
    <main className="learn-page">
      <div className="learn-modes tabs">
        <button className={mode === 'song' ? 'active' : ''} onClick={() => setMode('song')}>
          <FileAudio size={13} />Song or video file
        </button>
        <button className={mode === 'youtube' ? 'active' : ''} onClick={() => setMode('youtube')}>
          <Tv size={13} />YouTube
        </button>
      </div>
      {mode === 'song' ? <SongView /> : <YouTubeView onRecorded={() => setMode('song')} />}
    </main>
  );
}
