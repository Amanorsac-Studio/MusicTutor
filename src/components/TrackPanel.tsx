/**
 * Backing-track player.
 *
 * Occupies the inspector column whenever no source is selected, so the space is
 * useful during a lesson rather than empty. The track feeds the programme bus,
 * so it is heard, mixed and recorded alongside the piano.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Gauge, Music4, Pause, Play, Repeat, RotateCcw, Square, Timer, Trash2, Upload, Volume2,
} from 'lucide-react';
import { trackPlayer } from '../lib/player';
import { beatPosition, snapToBeat } from '../lib/tempo';

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Speeds a teacher actually uses when drilling a passage. */
const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

export function TrackPanel() {
  const [state, setState] = useState(trackPlayer.state);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // The player is the source of truth; mirror it rather than duplicating state.
  useEffect(() => trackPlayer.subscribe(() => setState(trackPlayer.state)), []);

  // The playhead moves continuously, so poll it while playing.
  useEffect(() => {
    if (!state.playing) return;
    const id = window.setInterval(() => setState(trackPlayer.state), 100);
    return () => window.clearInterval(id);
  }, [state.playing]);

  const { track } = state;

  const onFile = async (file: File) => {
    setLoading(true);
    setError('');
    try {
      await trackPlayer.load(file);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That file could not be read as audio.');
    } finally {
      setLoading(false);
    }
  };

  /** Loop the bar around the playhead, snapped to the beat grid. */
  const loopFourBars = () => {
    if (!track) return;
    const beat = 60 / state.bpm;
    const start = snapToBeat(state.position, state.bpm, track.tempo.offset);
    trackPlayer.setLoop({ start, end: Math.min(track.duration, start + beat * 16) });
  };

  return (
    <div className="track-panel">
      <div className="inspector-title"><span>Backing track</span><Music4 size={15} /></div>

      {!track && (
        <>
          <p className="panel-hint">
            Load a track to play along with. Tempo is detected on load, so the
            metronome and the loop points line up with the music.
          </p>
          <button className="primary small wide" onClick={() => fileRef.current?.click()} disabled={loading}>
            <Upload size={14} />{loading ? 'Reading…' : 'Import a track'}
          </button>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        aria-label="Import a track"
        style={{ display: 'none' }}
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) void onFile(file);
          event.target.value = '';
        }}
      />

      {error && <div className="page-banner error">{error}</div>}

      {track && (
        <>
          <div className="track-head">
            <b title={track.name}>{track.name}</b>
            <button aria-label="Remove track" onClick={() => trackPlayer.unload()}><Trash2 size={13} /></button>
          </div>

          {/* Tempo */}
          <div className="track-tempo">
            <span className="track-tempo-main">
              <Gauge size={14} />
              <b>{state.bpm.toFixed(1)}</b>
              <small>BPM</small>
            </span>
            <span className={`track-confidence ${track.tempo.confidence < 0.3 ? 'low' : ''}`}>
              {track.tempo.confidence < 0.3
                ? 'Tempo unclear — set it by hand'
                : `Detected · ${Math.round(track.tempo.confidence * 100)}% sure`}
            </span>
          </div>

          <label className="inspector-field wide">
            <span>Adjust tempo</span>
            <input
              type="range" min={40} max={240}
              aria-label="Tempo"
              value={Math.round(state.bpm)}
              onChange={event => trackPlayer.setBpm(Number(event.target.value))}
            />
          </label>

          {track.tempo.alternatives.length > 0 && (
            <div className="inspector-buttons">
              {track.tempo.alternatives.map(bpm => (
                <button key={bpm} onClick={() => trackPlayer.setBpm(bpm)}>{bpm} BPM</button>
              ))}
            </div>
          )}

          {/* Transport */}
          <div className="track-transport">
            <button aria-label="Back to start" onClick={() => trackPlayer.seek(0)}><RotateCcw size={15} /></button>
            <button
              className="track-play"
              aria-label={state.playing ? 'Pause track' : 'Play track'}
              onClick={() => (state.playing ? trackPlayer.pause() : trackPlayer.play())}
            >{state.playing ? <Pause size={17} /> : <Play size={17} />}</button>
            <button aria-label="Stop track" onClick={() => trackPlayer.stop()}><Square size={13} /></button>
            <span className="track-time">
              {formatTime(state.position)} / {formatTime(track.duration)}
            </span>
          </div>

          <input
            className="track-scrub"
            type="range"
            min={0}
            max={Math.max(0.1, track.duration)}
            step={0.01}
            aria-label="Position"
            value={state.position}
            onChange={event => trackPlayer.seek(Number(event.target.value))}
          />

          <div className="track-bar">
            Bar {beatPosition(state.position, state.bpm, track.tempo.offset).bar}
            {' · '}
            beat {beatPosition(state.position, state.bpm, track.tempo.offset).beat}
          </div>

          {/* Speed — pitch is preserved, which is the point */}
          <label className="section-label">Speed</label>
          <div className="speed-picks">
            {SPEEDS.map(speed => (
              <button
                key={speed}
                className={Math.abs(state.speed - speed) < 0.01 ? 'active' : ''}
                aria-pressed={Math.abs(state.speed - speed) < 0.01}
                onClick={() => trackPlayer.setSpeed(speed)}
              >{Math.round(speed * 100)}%</button>
            ))}
          </div>
          <small className="field-hint">Pitch stays put, so a slowed track is still in the same key.</small>

          {/* Looping */}
          <label className="section-label">Loop</label>
          <div className="inspector-buttons">
            <button
              className={state.looping ? 'active' : ''}
              aria-pressed={state.looping}
              onClick={() => trackPlayer.setLooping(!state.looping)}
            ><Repeat size={13} />{state.looping ? 'Looping' : 'Loop off'}</button>
            <button onClick={loopFourBars}><Timer size={13} />Loop 4 bars</button>
            <button onClick={() => trackPlayer.setLoop(null)}>Whole track</button>
          </div>
          {state.loop && (
            <small className="field-hint">
              Looping {formatTime(state.loop.start)} to {formatTime(state.loop.end)}.
            </small>
          )}

          {/* Metronome */}
          <label className="section-label">Metronome</label>
          <div className="inspector-buttons">
            <button
              className={state.metronome ? 'active' : ''}
              aria-pressed={state.metronome}
              onClick={() => trackPlayer.setMetronome(!state.metronome)}
            ><Timer size={13} />{state.metronome ? 'Clicking' : 'Click off'}</button>
          </div>

          <label className="inspector-field wide">
            <span><Volume2 size={12} /> Track volume</span>
            <input
              type="range" min={0} max={100}
              aria-label="Track volume"
              defaultValue={80}
              onChange={event => trackPlayer.setVolume(Number(event.target.value) / 100)}
            />
          </label>

          <button className="subtle-btn" onClick={() => fileRef.current?.click()}>
            <Upload size={13} />Load a different track
          </button>
        </>
      )}
    </div>
  );
}
