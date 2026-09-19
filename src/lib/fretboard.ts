/**
 * Where a note lives on a bass.
 *
 * A piano has one key per note. A bass does not: the A a player hears could be
 * the open A string, the fifth fret of the E string, or the tenth fret of the B
 * on a five-string. Audio alone cannot say which, because they are the same
 * pitch. So every position is shown, and one of them is marked as the likely
 * one — the position closest to where the hand already was, since a hand moves
 * as little as it can.
 */

import { pitchClass } from './chords';

export type BassTuning = {
  id: 'four' | 'five';
  label: string;
  /** Open strings as MIDI notes, lowest first. */
  strings: number[];
};

export const BASS_TUNINGS: Record<BassTuning['id'], BassTuning> = {
  four: { id: 'four', label: '4-string · E A D G', strings: [28, 33, 38, 43] },
  five: { id: 'five', label: '5-string · B E A D G', strings: [23, 28, 33, 38, 43] },
};

/** Frets drawn by default. Twelve covers where most bass playing happens. */
export const FRET_COUNT = 12;

/**
 * Neck lengths on offer. Twelve reads best on screen; twenty-four is a full
 * modern neck, for lines that climb past the octave.
 */
export const FRET_CHOICES = [12, 15, 17, 20, 24];

/** Hold a fret count to something a real bass has. */
export const clampFrets = (frets: number | undefined): number =>
  Math.max(5, Math.min(24, Math.round(Number(frets)) || FRET_COUNT));

export type FretPosition = {
  /** Index into the tuning's strings, 0 being the lowest. */
  string: number;
  /** 0 is the open string. */
  fret: number;
};

/** Every place a note can be played within the frets drawn. */
export function positionsFor(
  midi: number, tuning: Pick<BassTuning, 'strings'>, frets = FRET_COUNT,
): FretPosition[] {
  const out: FretPosition[] = [];
  tuning.strings.forEach((open, string) => {
    const fret = midi - open;
    if (fret >= 0 && fret <= frets) out.push({ string, fret });
  });
  return out;
}

/**
 * The position a player most likely used.
 *
 * With nothing to go on, the lowest fret wins, which is where a beginner plays
 * and where a teacher demonstrates. Once a note has been played, the nearest
 * position to it wins instead, counting a fret as one step and a string change
 * as roughly two, since crossing strings is cheap but not free.
 */
export function likelyPosition(
  positions: FretPosition[], previous: FretPosition | null,
): FretPosition | null {
  if (!positions.length) return null;
  if (!previous) {
    return positions.reduce((best, item) => (item.fret < best.fret ? item : best));
  }
  const cost = (item: FretPosition) =>
    Math.abs(item.fret - previous.fret) + Math.abs(item.string - previous.string) * 2;
  return positions.reduce((best, item) => (cost(item) < cost(best) ? item : best));
}

/** Scale degree names for every semitone above the key note. */
const DEGREES = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'];

/**
 * What a note is in the key: the 1, the ♭3, the 5.
 *
 * This is how bass players talk about lines — "one, five, flat seven" — and it
 * is what lets a line learned in one key be played in any other.
 */
export const noteDegree = (midi: number, keyRoot: number): string =>
  DEGREES[(pitchClass(midi) - pitchClass(keyRoot) + 12) % 12];

/** Frets that carry an inlay dot, as on nearly every real neck. */
export const INLAY_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];

/** The octave frets, which carry a double dot. */
export const DOUBLE_INLAYS = [12, 24];
