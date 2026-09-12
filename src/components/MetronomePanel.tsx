import { Timer, Volume2 } from 'lucide-react';
import { trackPlayer, type PlayerState } from '../lib/player';

/** Bar lengths a teacher actually counts in. */
const METERS = [2, 3, 4, 6];

/**
 * The click.
 *
 * Separate from the track on purpose: practising scales to a beat is at least
 * as common as playing along to a recording, and needing to import a song
 * first would be absurd. With a track loaded and playing it follows that
 * track's own beats; otherwise it keeps time by itself at the chosen tempo.
 */
export function MetronomePanel({ state }: { state: PlayerState }) {
  const following = Boolean(state.playing && state.track?.grid.beats.length);

  return (
    <>
      <label className="section-label">Metronome</label>
      <div className="inspector-buttons">
        <button
          className={state.metronome ? 'active' : ''}
          aria-pressed={state.metronome}
          onClick={() => trackPlayer.setMetronome(!state.metronome)}
        ><Timer size={13} />{state.metronome ? 'Clicking' : 'Click off'}</button>
      </div>

      {!state.track && (
        <label className="inspector-field wide">
          <span>Tempo · {Math.round(state.bpm)} BPM</span>
          <input
            type="range" min={30} max={240}
            aria-label="Metronome tempo"
            value={Math.round(state.bpm)}
            onChange={event => trackPlayer.setBpm(Number(event.target.value))}
          />
        </label>
      )}

      <div className="inspector-field wide">
        <span>Beats to the bar</span>
        <div className="inspector-buttons">
          {METERS.map(meter => (
            <button
              key={meter}
              className={state.beatsPerBar === meter ? 'active' : ''}
              aria-pressed={state.beatsPerBar === meter}
              onClick={() => trackPlayer.setBeatsPerBar(meter)}
            >{meter}</button>
          ))}
        </div>
      </div>

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
        Off by default: you hear it, the people watching do not.
        {following
          ? ' It is following the beats found in the track, so it stays with a performance that breathes.'
          : ' It is keeping its own time.'}
      </small>
    </>
  );
}
