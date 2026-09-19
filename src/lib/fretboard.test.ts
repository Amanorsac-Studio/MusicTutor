import { describe, expect, it } from 'vitest';
import { BASS_TUNINGS, likelyPosition, noteDegree, positionsFor } from './fretboard';

const four = BASS_TUNINGS.four;
const five = BASS_TUNINGS.five;

describe('positionsFor', () => {
  it('finds an open string', () => {
    expect(positionsFor(28, four)).toEqual([{ string: 0, fret: 0 }]);
  });

  it('finds every place the same pitch can be played', () => {
    // A1: open A string, or fifth fret of the E string.
    expect(positionsFor(33, four)).toEqual([
      { string: 0, fret: 5 },
      { string: 1, fret: 0 },
    ]);
  });

  it('adds the low B string on a five-string', () => {
    expect(positionsFor(33, five)).toContainEqual({ string: 0, fret: 10 });
  });

  it('returns nothing for a note below the instrument', () => {
    expect(positionsFor(20, four)).toEqual([]);
  });

  it('returns nothing for a note above the frets drawn', () => {
    expect(positionsFor(43 + 13, four)).toEqual([]);
  });
});

describe('likelyPosition', () => {
  it('prefers the lowest fret when there is nothing to go on', () => {
    expect(likelyPosition(positionsFor(33, four), null)).toEqual({ string: 1, fret: 0 });
  });

  it('prefers the position nearest the hand once a note has been played', () => {
    // The hand is at the seventh fret of the E string, so the A is more likely
    // the fifth fret beside it than the open string a long reach away.
    const previous = { string: 0, fret: 7 };
    expect(likelyPosition(positionsFor(33, four), previous)).toEqual({ string: 0, fret: 5 });
  });

  it('says nothing when the note is not on the neck', () => {
    expect(likelyPosition([], null)).toBeNull();
  });
});

describe('noteDegree', () => {
  it('calls the key note the 1', () => {
    expect(noteDegree(36, 0)).toBe('1');
  });

  it('names the fifth and the flat seventh of a bass line', () => {
    expect(noteDegree(43, 0)).toBe('5');
    expect(noteDegree(46, 0)).toBe('♭7');
  });

  it('follows the key', () => {
    // E in the key of A is the 5; in the key of E it is the 1.
    expect(noteDegree(28, 9)).toBe('5');
    expect(noteDegree(28, 4)).toBe('1');
  });

  it('is the same in every octave', () => {
    expect(noteDegree(28, 0)).toBe(noteDegree(40, 0));
  });
});

describe('a longer neck', () => {
  it('finds positions above the twelfth fret once they are shown', () => {
    // G3 is past the twelfth fret of the G string, so it is off a short neck.
    expect(positionsFor(43 + 14, four)).toEqual([]);
    expect(positionsFor(43 + 14, four, 24)).toContainEqual({ string: 3, fret: 14 });
  });

  it('offers more places for the same note as the neck grows', () => {
    expect(positionsFor(45, four, 24).length).toBeGreaterThan(positionsFor(45, four, 12).length);
  });
});
