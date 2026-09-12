/**
 * Backing-track player.
 *
 * Occupies the inspector column whenever no source is selected, so the space is
 * useful during a lesson rather than empty. The track feeds the programme bus,
 * so it is heard, mixed and recorded alongside the piano.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Gauge, Minus, Music4, Pause, Play, Plus, Repeat, RotateCcw, Square, Timer, Trash2,
  Upload, Volume2,
} from 'lucide-react';
import { trackPlayer } from '../lib/player';
import { Waveform } from './Waveform';
import type { BeatGrid } from '../lib/beats';

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Speeds a teacher actually uses when drilling a passage. */
const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

/** Bar counts worth a button each; anything else is a drag on the waveform. */
const LOOP_BARS = [1, 2, 4, 8];

/**
 * Which bar and beat the playhead is in, counted from the tracked beats.
 *
 * Counting real beats rather than dividing by the tempo means the reading stays
 * right through a track that speeds up or slows down.
 */
function barAndBeat(position: number, grid: BeatGrid): string {
  const { beats, beatsPerBar, firstDownbeat } = grid;
  if (!beats.length) return 'No beat grid';
  let index = 0;
  while (index + 1 < beats.length && beats[index + 1] <= position) index += 1;
  const fromDownbeat = index - firstDownbeat;
  const bar = Math.floor(fromDownbeat / beatsPerBar) + 1;
  const beat = (((fromDownbeat % beatsPerBar) + beatsPerBar) % beatsPerBar) + 1;
  return `Bar ${bar} · beat ${beat}`;
}

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

  /** Loop whole bars from the playhead, snapped to where the bars really are. */
  const loopBars = (bars: number) => trackPlayer.loopBars(state.position, bars);

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

          <Waveform
            peaks={track.peaks}
            duration={track.duration}
            position={state.position}
            loop={state.loop}
            grid={track.grid}
            snap={(time, toBar) => trackPlayer.snap(time, toBar)}
            onSeek={time => trackPlayer.seek(time)}
            onLoop={range => trackPlayer.setLoop(range)}
          />
          <small className="field-hint">
            Click to move the playhead, drag to set a loop. Both land on the beat; hold
            shift to land on the bar.
          </small>

          <div className="track-bar">{barAndBeat(state.position, track.grid)}</div>

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
          {state.rendering && (
            <div className="render-bar">
              <i style={{ width: `${Math.round(state.renderProgress * 100)}%` }} />
              <small>Re-rendering · {Math.round(state.renderProgress * 100)}%</small>
            </div>
          )}
          <small className="field-hint">
            Pitch stays put, so a slowed track is still in the same key. Changing the
            speed re-renders the track once, which takes a moment and then costs nothing
            while it plays.
          </small>

          {/* Transposition, which is independent of the speed */}
          <label className="section-label">Key</label>
          <div className="transpose-row">
            <button
              aria-label="Down a semitone"
              onClick={() => trackPlayer.transposeBy(-1)}
            ><Minus size={13} /></button>
            <b>
              {state.semitones === 0
                ? 'Original key'
                : `${state.semitones > 0 ? '+' : ''}${state.semitones} semitone${Math.abs(state.semitones) === 1 ? '' : 's'}`}
            </b>
            <button
              aria-label="Up a semitone"
              onClick={() => trackPlayer.transposeBy(1)}
            ><Plus size={13} /></button>
            <button
              className="subtle-btn"
              disabled={state.semitones === 0}
              onClick={() => trackPlayer.setSemitones(0)}
            >Reset</button>
          </div>
          <small className="field-hint">
            Moves the track to another key without changing its speed, for a singer or a
            transposing instrument that does not match the recording.
          </small>

          {/* Looping */}
          <label className="section-label">Loop</label>
          <div className="inspector-buttons">
            <button
              className={state.looping ? 'active' : ''}
              aria-pressed={state.looping}
              onClick={() => trackPlayer.setLooping(!state.looping)}
            ><Repeat size={13} />{state.looping ? 'Looping' : 'Loop off'}</button>
            {LOOP_BARS.map(bars => (
              <button key={bars} onClick={() => loopBars(bars)}>
                <Timer size={13} />{bars} bar{bars === 1 ? '' : 's'}
              </button>
            ))}
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
          <small className="field-hint">
            The click follows the beats found in the track rather than an even pulse, so
            it stays with a performance that breathes.
          </small>

          <label className="inspector-field wide">
            <span><Volume2 size={12} /> Click volume</span>
            <input
              type="range" min={0} max={100}
              aria-label="Click volume"
              value={Math.round(state.clickVolume * 100)}
              onChange={event => trackPlayer.setClickVolume(Number(event.target.value) / 100)}
            />
          </label>

          <label className="inspector-check">
            <input
              type="checkbox"
              checked={state.clickToStream}
              onChange={event => trackPlayer.setClickToStream(event.target.checked)}
            />
            Include the click in the recording and stream
          </label>
          <small className="field-hint">
            Off by default: you hear the click, the people watching do not. Turn it on
            for a play-along where the beat is part of the lesson.
          </small>

          <label className="section-label">Count-in</label>
          <div className="inspector-buttons">
            {[0, 2, 4].map(beats => (
              <button
                key={beats}
                className={state.countIn === beats ? 'active' : ''}
                aria-pressed={state.countIn === beats}
                onClick={() => trackPlayer.setCountIn(beats)}
              >{beats === 0 ? 'None' : `${beats} beats`}</button>
            ))}
          </div>

          <label className="inspector-field wide">
            <span><Volume2 size={12} /> Track volume</span>
            <input
              type="range" min={0} max={100}
              aria-label="Track volume"
              value={Math.round(state.volume * 100)}
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
