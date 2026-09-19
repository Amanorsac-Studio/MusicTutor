/**
 * Guitar chord shapes.
 *
 * A guitarist does not read a chord as a set of notes but as a shape under the
 * hand, so that is what is shown: the open-position shape where the chord has
 * one every player knows, and otherwise whichever barre shape sits lower on
 * the neck. The note names are worked out from the shape, not the other way
 * round, so what is drawn is always something that can actually be fingered.
 */

import type { ChordQuality } from './chordTrack';

/** Standard tuning, low E first, as MIDI notes. */
export const GUITAR_STRINGS = [40, 45, 50, 55, 59, 64];

/** One fret per string, low E first. -1 is a string that is not played. */
export type GuitarShape = number[];

const X = -1;

/** The open chords, by root pitch class then quality. */
const OPEN: Partial<Record<number, Partial<Record<ChordQuality, GuitarShape>>>> = {
  0: { maj: [X, 3, 2, 0, 1, 0], 7: [X, 3, 2, 3, 1, 0], maj7: [X, 3, 2, 0, 0, 0], 2: [X, 3, 2, 0, 3, 0], sus: [X, 3, 3, 0, 1, 1] },
  2: { maj: [X, X, 0, 2, 3, 2], min: [X, X, 0, 2, 3, 1], 7: [X, X, 0, 2, 1, 2], maj7: [X, X, 0, 2, 2, 2], m7: [X, X, 0, 2, 1, 1], sus: [X, X, 0, 2, 3, 3], 2: [X, X, 0, 2, 3, 0] },
  4: { maj: [0, 2, 2, 1, 0, 0], min: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], maj7: [0, 2, 1, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0], sus: [0, 2, 2, 2, 0, 0] },
  5: { maj7: [X, X, 3, 2, 1, 0] },
  7: { maj: [3, 2, 0, 0, 0, 3], 7: [3, 2, 0, 0, 0, 1], maj7: [3, 2, 0, 0, 0, 2], 2: [3, 0, 0, 2, 0, 3] },
  9: { maj: [X, 0, 2, 2, 2, 0], min: [X, 0, 2, 2, 1, 0], 7: [X, 0, 2, 0, 2, 0], maj7: [X, 0, 2, 1, 2, 0], m7: [X, 0, 2, 0, 1, 0], sus: [X, 0, 2, 2, 3, 0], 2: [X, 0, 2, 2, 0, 0] },
  11: { 7: [X, 2, 1, 2, 0, 2] },
};

/** Barre shapes with the root on the low E string, as offsets from the barre. */
const E_SHAPE: Record<ChordQuality, number[]> = {
  maj: [0, 2, 2, 1, 0, 0],
  min: [0, 2, 2, 0, 0, 0],
  7: [0, 2, 0, 1, 0, 0],
  maj7: [0, X, 1, 1, 0, X],
  m7: [0, 2, 0, 0, 0, 0],
  sus: [0, 2, 2, 2, 0, 0],
  2: [0, 2, 4, 1, 0, 0],
  dim: [0, 1, 2, 0, X, X],
};

/** And with the root on the A string. */
const A_SHAPE: Record<ChordQuality, number[]> = {
  maj: [X, 0, 2, 2, 2, 0],
  min: [X, 0, 2, 2, 1, 0],
  7: [X, 0, 2, 0, 2, 0],
  maj7: [X, 0, 2, 1, 2, 0],
  m7: [X, 0, 2, 0, 1, 0],
  sus: [X, 0, 2, 2, 3, 0],
  2: [X, 0, 2, 2, 0, 0],
  dim: [X, 0, 1, 2, 1, X],
};

/** A playable shape for a chord. */
export function guitarShape(root: number, quality: ChordQuality): GuitarShape {
  const pitch = ((root % 12) + 12) % 12;
  const open = OPEN[pitch]?.[quality];
  if (open) return open;
  // A barre at the nut is an open chord, and those are all listed above, so a
  // root that falls on an open string is played an octave up the neck instead.
  const onE = ((pitch - 4 + 12) % 12) || 12;
  const onA = ((pitch - 9 + 12) % 12) || 12;
  const [barre, shape] = onE <= onA ? [onE, E_SHAPE[quality]] : [onA, A_SHAPE[quality]];
  return shape.map(offset => (offset === X ? X : barre + offset));
}

/** The note each string of a shape sounds, or null where it is not played. */
export const shapeNotes = (shape: GuitarShape): Array<number | null> =>
  shape.map((fret, string) => (fret === X ? null : GUITAR_STRINGS[string] + fret));

/** How far up the neck a drawing needs to reach to show a shape comfortably. */
export const shapeReach = (shape: GuitarShape): number =>
  Math.max(5, ...shape.filter(fret => fret > 0)) + 1;
