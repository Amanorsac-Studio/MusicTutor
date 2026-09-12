/**
 * Grand-staff placement for played notes.
 *
 * Staff position is diatonic, not chromatic: C♯ and C sit on the same line and
 * are told apart by the accidental. So a note is first spelled as a letter plus
 * an accidental, and the letter alone decides the height.
 *
 * Heights are counted in "steps", one per letter, so a step is half a staff
 * space. Middle C is step 28, which puts it exactly between the two staves.
 */

import { pitchClass, type Accidental } from './chords';

/** Middle C (MIDI 60) in diatonic steps: octave 4 × 7 letters + C. */
export const MIDDLE_C_STEP = 28;

/** Bottom and top lines of each staff, as steps. */
export const TREBLE_BOTTOM = 30; // E4
export const TREBLE_TOP = 38;    // F5
export const BASS_TOP = 26;      // A3
export const BASS_BOTTOM = 18;   // G2

/** Letter index (C=0 … B=6) for each pitch class, spelled with sharps. */
const SHARP_LETTERS = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
/** The same, spelled with flats: D♭ is a D, not a C. */
const FLAT_LETTERS = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
/** Which pitch classes need an accidental sign under each spelling. */
const IS_ALTERED = [false, true, false, true, false, false, true, false, true, false, true, false];

export type Clef = 'treble' | 'bass';

export type Placement = {
  midi: number;
  /** Diatonic height; larger is higher in pitch. */
  step: number;
  /** Which staff the note is drawn against. */
  clef: Clef;
  /** '♯', '♭' or '' — the sign drawn to the left of the notehead. */
  accidental: string;
  /** Letter name without the octave, for labelling. */
  letter: string;
};

const LETTER_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * Where a MIDI note sits on the grand staff.
 *
 * The clef is chosen by pitch alone — middle C and above on the treble staff —
 * which is what a player expects and keeps the two hands visually apart.
 */
export function placeNote(midi: number, accidental: Accidental = 'sharp'): Placement {
  const pc = pitchClass(midi);
  const octave = Math.floor(midi / 12) - 1;
  const useFlats = accidental === 'flat';
  const letterIndex = useFlats ? FLAT_LETTERS[pc] : SHARP_LETTERS[pc];
  const step = octave * 7 + letterIndex;
  return {
    midi,
    step,
    clef: step >= MIDDLE_C_STEP ? 'treble' : 'bass',
    accidental: IS_ALTERED[pc] ? (useFlats ? '♭' : '♯') : '',
    letter: LETTER_NAMES[letterIndex],
  };
}

/**
 * The short lines drawn through a note that sits outside its staff.
 *
 * Ledger lines fall on even steps, continuing the staff's own spacing, and
 * there is one between the staves for middle C.
 */
export function ledgerSteps(step: number): number[] {
  const lines: number[] = [];
  if (step > TREBLE_TOP) {
    for (let line = TREBLE_TOP + 2; line <= step; line += 2) lines.push(line);
  } else if (step < BASS_BOTTOM) {
    for (let line = BASS_BOTTOM - 2; line >= step; line -= 2) lines.push(line);
  } else if (step > BASS_TOP && step < TREBLE_BOTTOM) {
    // Only middle C falls on a line here; its neighbours sit in the spaces.
    if (step === MIDDLE_C_STEP) lines.push(MIDDLE_C_STEP);
  }
  return lines;
}

export type StaffGeometry = {
  /** One staff space, in pixels. */
  space: number;
  /** Vertical centre of the grand staff, where middle C sits. */
  middleY: number;
  /** Left edge of the note area, past the clefs. */
  noteLeft: number;
  /** Right edge of the staff lines. */
  right: number;
};

/**
 * Fit a grand staff into a box.
 *
 * The two staves span ten spaces from the bass bottom line to the treble top,
 * and notes routinely run a few ledger lines beyond, so sixteen spaces of room
 * keeps the common range inside the box.
 */
export function staffGeometry(width: number, height: number): StaffGeometry {
  const space = height / 16;
  const clefRoom = Math.min(width * 0.22, space * 5);
  return {
    space,
    middleY: height / 2,
    noteLeft: clefRoom,
    right: width,
  };
}

/** Pixel height of a step, given the geometry. */
export const stepY = (step: number, geometry: StaffGeometry): number =>
  geometry.middleY - (step - MIDDLE_C_STEP) * (geometry.space / 2);

/** The five line steps of a staff, bottom to top. */
export const staffLines = (clef: Clef): number[] =>
  (clef === 'treble'
    ? [TREBLE_BOTTOM, TREBLE_BOTTOM + 2, TREBLE_BOTTOM + 4, TREBLE_BOTTOM + 6, TREBLE_TOP]
    : [BASS_BOTTOM, BASS_BOTTOM + 2, BASS_BOTTOM + 4, BASS_BOTTOM + 6, BASS_TOP]);

/**
 * Spread simultaneous notes across the width so a chord reads as a chord.
 *
 * Notes a step apart would collide, so the second of such a pair is nudged to
 * the right by one notehead, which is how a chord is engraved on paper.
 */
export function noteOffsets(placements: Placement[]): number[] {
  const order = placements.map((placement, index) => ({ placement, index }))
    .sort((a, b) => a.placement.step - b.placement.step);
  const offsets = new Array<number>(placements.length).fill(0);
  let previousStep = -Infinity;
  let previousOffset = 0;
  order.forEach(({ placement, index }) => {
    const collides = placement.step - previousStep === 1 && previousOffset === 0;
    offsets[index] = collides ? 1 : 0;
    previousStep = placement.step;
    previousOffset = offsets[index];
  });
  return offsets;
}

/* ------------------------------------------------------------------ *
 * Clef glyphs
 * ------------------------------------------------------------------ */

/**
 * Clefs drawn as curves rather than as the letters G and F.
 *
 * A music font cannot be relied on, and the words "treble" and "bass" are not
 * what a musician reads for. Both shapes are defined in staff spaces, with the
 * origin on the line the clef names, so they land correctly at any size.
 */

/** Points of an Archimedean spiral, for the eye of the G clef. */
export function spiralPoints(
  turns: number, startRadius: number, endRadius: number, steps = 48,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const total = turns * Math.PI * 2;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = t * total;
    const radius = startRadius + (endRadius - startRadius) * t;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return points;
}
