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
  ArrowLeft, ArrowRight, Ear, FileAudio, Home, Minus, Pause, Play, Plus, Repeat, RotateCw,
  Scissors, Square, Trash2, Tv, Upload, Volume2,
} from 'lucide-react';
import { useStudio } from '../lib/useStudio';
import { learnPlayer } from '../lib/player';
import { learnSession, STEM_LABELS, STEM_ORDER, type LearnSource } from '../lib/learn';
import { liveListener } from '../lib/liveListen';
import { chordAt, chordLabel, chordVoicing, CHORD_SHAPES } from '../lib/chordTrack';
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

/** The bass neck, following the notes heard in the bass stem. */
function LearnFretboard({ midi }: { midi: number | null }) {
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
      keyRoot: settings.keyRoot,
      accidental: settings.accidental,
      accent: '#ffa629',
      background: 'transparent',
      showReadout: true,
    });
  }, [midi, size, settings.bassTuning, settings.bassFrets, settings.keyRoot, settings.accidental]);

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
      const now = learnPlayer.position;
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

  const onFile = (file: File) => {
    void learnSession.open(file, settings.concertPitch);
  };

  const bassLine = session.source === 'bass';
  const busy = Boolean(session.working);
  const stems = session.stems;

  return (
    <div className="learn-song">
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/*"
        aria-label="Import a song or video"
        style={{ display: 'none' }}
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />

      {!track && !busy && (
        <div
          className="learn-empty"
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) onFile(file);
          }}
        >
          <FileAudio size={34} />
          <h2>Import a song to learn it</h2>
          <p>
            Drop an audio or video file here. The chords are named, the notes are
            laid out on a piano roll, and you can loop, slow down and transpose
            any part of it. Everything is worked out on this computer.
          </p>
          <button className="primary small" onClick={() => fileRef.current?.click()}>
            <Upload size={14} />Import a song or video
          </button>
          {session.error && <div className="page-banner error">{session.error}</div>}
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
                <small>{STEM_LABELS[session.source]} · chord now</small>
                <strong>{chord ? chordLabel(chord, settings.accidental, transpose) : '—'}</strong>
                <span>{nextChord ? `Next: ${chordLabel(nextChord, settings.accidental, transpose)}` : ' '}</span>
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
                {!busy && !session.notes.length && session.source !== 'drums' && (
                  <small className="learn-quiet">No clear notes were heard in this part.</small>
                )}
                {session.error && <div className="page-banner error">{session.error}</div>}
              </div>
            </div>

            <PianoRoll
              notes={session.notes}
              chords={session.chords}
              grid={track.grid}
              range={range}
              accidental={settings.accidental}
              transpose={transpose}
              getPosition={getPosition}
              loop={player.looping ? player.loop : null}
              onSeek={time => learnPlayer.seek(time)}
            />

            <div className={`learn-instrument ${bassLine ? 'neck' : ''}`}>
              {bassLine ? (
                <LearnFretboard midi={sounding.length ? sounding[0] + transpose : null} />
              ) : (
                <PianoKeyboard
                  active={lit}
                  onNoteOn={noteOn}
                  onNoteOff={noteOff}
                  range={KEY_RANGES['88']}
                  accidental={settings.accidental}
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

            <hr />
            <div className="inspector-title"><span>Instruments</span><Scissors size={15} /></div>

            {stems.phase === 'none' && (
              <>
                <p className="panel-hint">
                  Split the song into bass, keys, guitar, vocals and drums, then study one on its own.
                  It takes a few minutes and is kept, so it only happens once per song.
                  The first time, a 136 MB model is downloaded.
                </p>
                <button className="primary small wide" onClick={() => void learnSession.separate()} disabled={busy}>
                  <Scissors size={14} />Separate the instruments
                </button>
              </>
            )}
            {(stems.phase === 'downloading' || stems.phase === 'separating') && (
              <div className="learn-progress" role="status">
                <span>
                  {stems.phase === 'downloading'
                    ? `Downloading the model… ${Math.round(stems.progress * 100)}%`
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

            <div className="learn-stems">
              {STEM_ORDER.map((source: LearnSource) => (
                <button
                  key={source}
                  className={session.source === source ? 'active' : ''}
                  disabled={busy || (source !== 'mix' && stems.phase !== 'ready')}
                  onClick={() => void learnSession.listenTo(source)}
                >{STEM_LABELS[source]}</button>
              ))}
            </div>
            {stems.phase === 'ready' && (
              <p className="panel-hint">
                Pick an instrument to hear it alone and see its notes. Bass shows on a bass neck.
                Keys are the hardest instrument to separate cleanly, so expect some bleed.
              </p>
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

function YouTubeView() {
  const { settings, activeNotes, noteOn, noteOff } = useStudio();
  const live = useStore(liveListener);
  const holder = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState(YOUTUBE_HOME);
  const isDesktop = Boolean(window.pianoTutorDesktop?.isDesktop);

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

  const chord = live.chord;
  const lit = useMemo(() => {
    const set = new Set(activeNotes);
    if (chord) chordVoicing(chord.root, chord.quality).forEach(m => set.add(m));
    return set;
  }, [activeNotes, chord]);

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
        </div>
        <div className="learn-webview" ref={holder}>
          {createElement('webview', {
            src: YOUTUBE_HOME,
            partition: 'persist:learn-youtube',
            style: { width: '100%', height: '100%' },
          })}
        </div>
      </div>

      <div className="learn-live">
        <div className="learn-chord">
          <small>{live.listening ? 'Chord now' : 'Not listening'}</small>
          <strong>{chord ? chordLabel(chord, settings.accidental) : '—'}</strong>
          <span>&nbsp;</span>
        </div>
        <div className="learn-live-side">
          <button
            className={`primary small ${live.listening ? 'listening' : ''}`}
            onClick={() => (live.listening ? liveListener.stop() : void liveListener.start(settings.concertPitch))}
          ><Ear size={14} />{live.listening ? 'Stop listening' : 'Listen and name the chords'}</button>
          <p className="panel-hint">
            Play a video, then listen. The app hears what the computer is playing and names the chord a moment
            behind the music. A video cannot be slowed, looped or separated here — for that, import the song as a file.
          </p>
          {live.error && <div className="page-banner error">{live.error}</div>}
        </div>
        <div className="learn-instrument">
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
      {mode === 'song' ? <SongView /> : <YouTubeView />}
    </main>
  );
}
