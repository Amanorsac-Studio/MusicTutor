/**
 * The Stems tab: split any song into its instruments, fast.
 *
 * A single, plain workflow — import, split, mute or solo whichever part is
 * wanted, download it — with none of Learn's chord and note detection to wait
 * on. Separation itself runs once per song, on this computer; a song split
 * before opens instantly from the cache the second time.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Download, Pause, Play, Repeat, Scissors, Square, Trash2, Upload, Volume2, VolumeX, Waves,
} from 'lucide-react';
import { stemStudio, STEM_LABELS, STEM_ORDER } from '../lib/stemStudio';
import { stemsPlayer } from '../lib/player';

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

function useStore<T>(store: { state: T; subscribe: (listener: () => void) => () => void }): T {
  const [state, setState] = useState(store.state);
  useEffect(() => {
    setState(store.state);
    return store.subscribe(() => setState(store.state));
  }, [store]);
  return state;
}

export function StemsPage() {
  const session = useStore(stemStudio);
  const player = useStore(stemsPlayer);
  const fileRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setPosition(stemsPlayer.position), 100);
    return () => window.clearInterval(id);
  }, []);

  const onFiles = (files: File[]) => {
    const file = files.find(item => item.type.startsWith('audio/') || item.type.startsWith('video/')) ?? files[0];
    if (file) void stemStudio.open(file);
  };

  const { track } = player;
  const busy = session.phase === 'downloading' || session.phase === 'separating' || session.phase === 'loading';
  const ready = session.phase === 'ready';
  const allAudible = STEM_ORDER.every(stem => session.audible[stem]);

  return (
    <main className="workspace-page stems-page">
      <header>
        <div>
          <span className="eyebrow">STEMS</span>
          <h1>Split a song into its instruments</h1>
          <p>Drums, bass, guitar, keys, vocals and everything else — separated on this computer, in minutes the first time and instantly after.</p>
        </div>
      </header>

      <div className="page-grid stems-grid">
        <div className="content-card span-two">
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/*"
            aria-label="Import a song"
            style={{ display: 'none' }}
            onChange={event => {
              onFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />

          {!track && (
            <div
              className="learn-empty stems-drop"
              onDragOver={event => event.preventDefault()}
              onDrop={event => {
                event.preventDefault();
                onFiles(Array.from(event.dataTransfer.files ?? []));
              }}
            >
              <Waves size={34} />
              <h2>Drop a song or video here</h2>
              <p>MP3, WAV, M4A or MP4. Nothing leaves this computer.</p>
              <button className="primary small" onClick={() => fileRef.current?.click()}>
                <Upload size={14} />Choose a file
              </button>
              {session.error && <div className="page-banner error">{session.error}</div>}
            </div>
          )}

          {track && (
            <>
              <div className="learn-status">
                <b title={session.fileName}>{session.fileName}</b>
                <small>{formatTime(track.duration)}</small>
              </div>

              <div className="learn-transport">
                <div className="track-transport">
                  <button
                    className="track-play"
                    aria-label={player.playing ? 'Pause' : 'Play'}
                    onClick={() => (player.playing ? stemsPlayer.pause() : stemsPlayer.play())}
                  >{player.playing ? <Pause size={17} /> : <Play size={17} />}</button>
                  <button aria-label="Stop" onClick={() => stemsPlayer.stop()}><Square size={13} /></button>
                  <button
                    aria-label="Loop"
                    aria-pressed={player.looping}
                    className={player.looping ? 'on' : ''}
                    onClick={() => stemsPlayer.setLooping(!player.looping)}
                  ><Repeat size={14} /></button>
                </div>
                <span className="learn-time">{formatTime(position)} / {formatTime(track.duration)}</span>
                <input
                  className="stems-seek"
                  type="range" min={0} max={track.duration || 1} step={0.1} value={Math.min(position, track.duration)}
                  aria-label="Seek"
                  onChange={event => stemsPlayer.seek(Number(event.target.value))}
                />
                <label className="learn-group learn-volume">
                  <Volume2 size={13} />
                  <input
                    type="range" min={0} max={1} step={0.01} value={player.volume}
                    aria-label="Volume"
                    onChange={event => stemsPlayer.setVolume(Number(event.target.value))}
                  />
                </label>
              </div>

              {session.phase === 'none' && (
                <>
                  <p className="panel-hint">
                    Split this into drums, bass, guitar, keys and vocals, plus everything else (synths, pads, extra parts) as Aux.
                    Mute the part you want to play, or solo it to hear it alone. Each stem can be saved as its own file.
                  </p>
                  <button className="primary small wide" onClick={() => void stemStudio.separate()}>
                    <Scissors size={14} />Separate the instruments
                  </button>
                </>
              )}

              {busy && (
                <div className="learn-progress" role="status">
                  <span>
                    {session.phase === 'downloading'
                      ? `Downloading the model… ${Math.round(session.progress * 100)}%`
                      : session.phase === 'loading'
                        ? 'Opening the instruments…'
                        : session.progress > 0
                          ? `Separating… ${Math.round(session.progress * 100)}%`
                          : 'Getting ready. This first step takes half a minute…'}
                  </span>
                  <i><em style={{ width: `${Math.round(session.progress * 100)}%` }} /></i>
                  {session.phase === 'separating' && (
                    <button className="subtle-btn" onClick={() => stemStudio.cancel()}>Cancel</button>
                  )}
                </div>
              )}
              {session.error && <div className="page-banner error">{session.error}</div>}

              {ready && (
                <>
                  <div className="learn-mixer stems-mixer">
                    {STEM_ORDER.map(stem => (
                      <div key={stem} className={`learn-stem ${session.audible[stem] ? '' : 'muted'}`}>
                        <button
                          className="learn-mute"
                          aria-pressed={!session.audible[stem]}
                          aria-label={`${session.audible[stem] ? 'Mute' : 'Unmute'} ${STEM_LABELS[stem]}`}
                          onClick={() => stemStudio.toggle(stem)}
                        >{session.audible[stem] ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>
                        <span>{STEM_LABELS[stem]}</span>
                        <button className="learn-solo" onClick={() => stemStudio.solo(stem)}>Solo</button>
                        <button
                          className="icon-btn"
                          aria-label={`Download ${STEM_LABELS[stem]}`}
                          onClick={() => void stemStudio.download(stem)}
                        ><Download size={14} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="stems-actions">
                    <button className="subtle-btn" onClick={() => stemStudio.everyone()} disabled={allAudible}>
                      Bring everyone back
                    </button>
                    <button className="subtle-btn" onClick={() => void stemStudio.downloadAll()}>
                      <Download size={13} />Download all six
                    </button>
                  </div>
                </>
              )}

              <button className="subtle-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload size={13} />Import another
              </button>
              <button className="subtle-btn" onClick={() => stemStudio.close()}>
                <Trash2 size={13} />Close this song
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
