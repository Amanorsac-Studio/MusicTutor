/**
 * Live chord readout for the virtual keyboard: chord symbol, quality,
 * inversion, the notes sounding, and Roman numeral analysis in the chosen key.
 */

import { useMemo } from 'react';
import {
  detectChord, noteLabel, romanNumeral, scaleNotes,
  KEY_NAMES, type Accidental, type Mode,
} from '../lib/chords';

export type ChordDisplayProps = {
  notes: Iterable<number>;
  accidental?: Accidental;
  keyRoot?: number;
  mode?: Mode;
  showAnalysis?: boolean;
  compact?: boolean;
};

export function ChordDisplay({
  notes,
  accidental = 'sharp',
  keyRoot = 0,
  mode = 'major',
  showAnalysis = true,
  compact = false,
}: ChordDisplayProps) {
  const noteList = useMemo(() => [...new Set(notes)].sort((a, b) => a - b), [notes]);
  const chord = useMemo(() => detectChord(noteList, accidental), [noteList, accidental]);
  const numeral = useMemo(
    () => (chord && showAnalysis ? romanNumeral(chord, keyRoot, mode) : null),
    [chord, keyRoot, mode, showAnalysis],
  );

  if (!noteList.length) {
    return (
      <div className={`chord-display empty ${compact ? 'compact' : ''}`} aria-live="polite">
        <span className="chord-symbol placeholder">—</span>
        <span className="chord-hint">Play two or more notes to identify a chord</span>
      </div>
    );
  }

  if (!chord) {
    return (
      <div className={`chord-display ${compact ? 'compact' : ''}`} aria-live="polite">
        <span className="chord-symbol">{noteLabel(noteList[0], accidental)}</span>
        <span className="chord-hint">Single note</span>
      </div>
    );
  }

  return (
    <div className={`chord-display ${compact ? 'compact' : ''}`} aria-live="polite">
      <div className="chord-main">
        <span className="chord-symbol" title={`${chord.rootName} ${chord.quality}`}>
          {chord.symbol}
        </span>
        {numeral && (
          <span className="chord-numeral" title={`Roman numeral in ${KEY_NAMES[keyRoot]} ${mode}`}>
            {numeral}
          </span>
        )}
      </div>
      <div className="chord-meta">
        <span className="chord-quality">{chord.quality}</span>
        {chord.inversionName !== 'root position' && chord.inversionName !== 'interval' && (
          <span className="chord-inversion">{chord.inversionName}</span>
        )}
        {!chord.exact && chord.missing.length > 0 && <span className="chord-partial">no 5th</span>}
      </div>
      <div className="chord-notes">
        {noteList.map(note => (
          <span key={note} className="chord-note">{noteLabel(note, accidental)}</span>
        ))}
      </div>
    </div>
  );
}

/** Key and mode selector used alongside the chord readout. */
export function KeySelector({
  keyRoot, mode, onKeyRoot, onMode,
}: {
  keyRoot: number;
  mode: Mode;
  onKeyRoot: (value: number) => void;
  onMode: (value: Mode) => void;
}) {
  const scale = scaleNotes(keyRoot, mode);
  return (
    <div className="key-selector">
      <label>
        <span className="visually-hidden">Key</span>
        <select value={keyRoot} onChange={event => onKeyRoot(Number(event.target.value))} aria-label="Key">
          {KEY_NAMES.map((name, index) => (
            <option key={name} value={index}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="visually-hidden">Mode</span>
        <select value={mode} onChange={event => onMode(event.target.value as Mode)} aria-label="Mode">
          <option value="major">major</option>
          <option value="minor">minor</option>
        </select>
      </label>
      <span className="key-scale" aria-label="Notes in this key">
        {scale.map(pc => KEY_NAMES[pc]).join(' ')}
      </span>
    </div>
  );
}
