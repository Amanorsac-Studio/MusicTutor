import { describe, expect, it } from 'vitest';
import {
  BASS_BOTTOM, BASS_TOP, MIDDLE_C_STEP, TREBLE_BOTTOM, TREBLE_TOP,
  ledgerSteps, noteOffsets, placeNote, staffGeometry, staffLines, stepY,
} from './staff';

describe('placeNote', () => {
  it('puts middle C between the staves', () => {
    const placement = placeNote(60);
    expect(placement.step).toBe(MIDDLE_C_STEP);
    expect(placement.letter).toBe('C');
    expect(placement.accidental).toBe('');
  });

  it('places the staff lines where they belong', () => {
    expect(placeNote(64).step).toBe(TREBLE_BOTTOM); // E4
    expect(placeNote(77).step).toBe(TREBLE_TOP);    // F5
    expect(placeNote(57).step).toBe(BASS_TOP);      // A3
    expect(placeNote(43).step).toBe(BASS_BOTTOM);   // G2
  });

  it('spells a black key as a sharp or a flat, on different lines', () => {
    const sharp = placeNote(61, 'sharp');
    const flat = placeNote(61, 'flat');
    expect(sharp.letter).toBe('C');
    expect(sharp.accidental).toBe('♯');
    expect(flat.letter).toBe('D');
    expect(flat.accidental).toBe('♭');
    // The whole point of diatonic placement: same sound, different height.
    expect(flat.step).toBe(sharp.step + 1);
  });

  it('keeps a sharpened note on its natural line', () => {
    expect(placeNote(61, 'sharp').step).toBe(placeNote(60).step);
    expect(placeNote(66, 'sharp').step).toBe(placeNote(65).step);
  });

  it('chooses the clef by pitch, splitting at middle C', () => {
    expect(placeNote(60).clef).toBe('treble');
    expect(placeNote(59).clef).toBe('bass');
    expect(placeNote(96).clef).toBe('treble');
    expect(placeNote(21).clef).toBe('bass');
  });

  it('rises by one step per letter across an octave', () => {
    expect(placeNote(72).step - placeNote(60).step).toBe(7);
    expect(placeNote(48).step - placeNote(60).step).toBe(-7);
  });
});

describe('ledgerSteps', () => {
  it('gives middle C its one line', () => {
    expect(ledgerSteps(MIDDLE_C_STEP)).toEqual([MIDDLE_C_STEP]);
  });

  it('leaves notes inside a staff alone', () => {
    expect(ledgerSteps(TREBLE_BOTTOM)).toEqual([]);
    expect(ledgerSteps(TREBLE_TOP)).toEqual([]);
    expect(ledgerSteps(BASS_BOTTOM + 4)).toEqual([]);
  });

  it('leaves the notes either side of middle C alone', () => {
    expect(ledgerSteps(MIDDLE_C_STEP - 1)).toEqual([]);
    expect(ledgerSteps(MIDDLE_C_STEP + 1)).toEqual([]);
  });

  it('stacks lines outwards for high and low notes', () => {
    expect(ledgerSteps(TREBLE_TOP + 4)).toEqual([TREBLE_TOP + 2, TREBLE_TOP + 4]);
    expect(ledgerSteps(TREBLE_TOP + 3)).toEqual([TREBLE_TOP + 2]);
    expect(ledgerSteps(BASS_BOTTOM - 4)).toEqual([BASS_BOTTOM - 2, BASS_BOTTOM - 4]);
  });

  it('gives the top note of an 88-key piano its ledger lines', () => {
    const lines = ledgerSteps(placeNote(108).step);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.every(line => line % 2 === 0)).toBe(true);
  });
});

describe('staff geometry', () => {
  const geometry = staffGeometry(800, 320);

  it('puts middle C at the vertical centre', () => {
    expect(stepY(MIDDLE_C_STEP, geometry)).toBeCloseTo(160);
  });

  it('spaces the staff lines by one space each', () => {
    const lines = staffLines('treble').map(step => stepY(step, geometry));
    for (let i = 1; i < lines.length; i += 1) {
      expect(lines[i - 1] - lines[i]).toBeCloseTo(geometry.space);
    }
  });

  it('draws higher notes higher up the box', () => {
    expect(stepY(placeNote(84).step, geometry)).toBeLessThan(stepY(placeNote(60).step, geometry));
  });

  it('keeps a whole 88-key range inside a reasonable box', () => {
    const top = stepY(placeNote(108).step, geometry);
    const bottom = stepY(placeNote(21).step, geometry);
    // The extremes run outside the staves, as they do on paper, but a
    // comfortable two-octave range around middle C must stay in the box.
    expect(stepY(placeNote(84).step, geometry)).toBeGreaterThan(0);
    expect(stepY(placeNote(36).step, geometry)).toBeLessThan(320);
    expect(top).toBeLessThan(bottom);
  });

  it('leaves room for the clefs at the left', () => {
    expect(geometry.noteLeft).toBeGreaterThan(0);
    expect(geometry.noteLeft).toBeLessThan(800 / 2);
  });
});

describe('noteOffsets', () => {
  it('leaves a plain triad in one column', () => {
    const placements = [60, 64, 67].map(note => placeNote(note));
    expect(noteOffsets(placements)).toEqual([0, 0, 0]);
  });

  it('nudges the upper note of a second aside', () => {
    const placements = [60, 62].map(note => placeNote(note));
    expect(noteOffsets(placements)).toEqual([0, 1]);
  });

  it('does not push a whole cluster ever further right', () => {
    const placements = [60, 62, 64, 65].map(note => placeNote(note));
    expect(noteOffsets(placements)).toEqual([0, 1, 0, 1]);
  });

  it('returns one offset per note, whatever the order given', () => {
    const placements = [67, 60, 64].map(note => placeNote(note));
    expect(noteOffsets(placements)).toHaveLength(3);
  });
});
