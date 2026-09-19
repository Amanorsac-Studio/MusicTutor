/**
 * Three ways of saying which note is sounding.
 *
 * Letter names say what the note is. Solfa and numbers say what it does in the
 * key, which is what lets a line learned in C be sung or played in any other
 * key, and it is how a great many musicians are taught: tonic sol-fa in
 * churches and choirs, numbers in band rooms.
 *
 * Solfa here is movable: do is the key note, not always C. In a minor key it is
 * la-based, as tonic sol-fa teaches it — the key note of A minor is la, so the
 * scale reads la ti do re mi fa sol — because that keeps the syllables of a
 * minor key the same as those of its relative major, which is the whole point
 * of the system.
 */

import { noteName, pitchClass, type Accidental, type Mode } from './chords';

export type NoteLabelMode = 'names' | 'solfa' | 'numbers';

/** Syllables for each semitone above do, raised forms for sharp spelling. */
const SOLFA_SHARP = ['do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'sol', 'si', 'la', 'li', 'ti'];
/** And lowered forms for flat spelling. */
const SOLFA_FLAT = ['do', 'ra', 're', 'me', 'mi', 'fa', 'se', 'sol', 'le', 'la', 'te', 'ti'];

/** Scale degrees for each semitone above the key note. */
const NUMBERS = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'];

/**
 * Where do is, as a pitch class.
 *
 * In a major key it is the key note. In a minor key the key note is la, which
 * puts do a minor third above it.
 */
export const doPitchClass = (keyRoot: number, mode: Mode): number =>
  (pitchClass(keyRoot) + (mode === 'minor' ? 3 : 0)) % 12;

/** The solfa syllable for a note in a key. */
export function solfaOf(midi: number, keyRoot: number, mode: Mode, accidental: Accidental): string {
  const above = (pitchClass(midi) - doPitchClass(keyRoot, mode) + 12) % 12;
  return (accidental === 'flat' ? SOLFA_FLAT : SOLFA_SHARP)[above];
}

/**
 * The scale degree of a note, counted from the key note.
 *
 * Numbers stay on the key note in a minor key too — the key note of A minor is
 * 1 and its third is ♭3 — which is how players who think in numbers talk.
 */
export const numberOf = (midi: number, keyRoot: number): string =>
  NUMBERS[(pitchClass(midi) - pitchClass(keyRoot) + 12) % 12];

/** One note, labelled the chosen way. */
export function labelNote(
  midi: number,
  labelMode: NoteLabelMode,
  key: { keyRoot: number; mode: Mode; accidental: Accidental },
): string {
  if (labelMode === 'solfa') return solfaOf(midi, key.keyRoot, key.mode, key.accidental);
  if (labelMode === 'numbers') return numberOf(midi, key.keyRoot);
  return noteName(midi, key.accidental);
}

/**
 * Labels for everything sounding, low to high.
 *
 * A note doubled at the octave is said once: a pianist holding C in both hands
 * is playing do, not do do, and the display is for reading, not for counting
 * fingers.
 */
export function labelNotes(
  notes: Iterable<number>,
  labelMode: NoteLabelMode,
  key: { keyRoot: number; mode: Mode; accidental: Accidental },
): string[] {
  const seen = new Set<number>();
  const out: string[] = [];
  [...notes].sort((a, b) => a - b).forEach(midi => {
    const pc = pitchClass(midi);
    if (seen.has(pc)) return;
    seen.add(pc);
    out.push(labelNote(midi, labelMode, key));
  });
  return out;
}
