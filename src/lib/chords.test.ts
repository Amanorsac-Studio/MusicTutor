import { describe, expect, it } from 'vitest';
import {
  detectChord, frequencyOf, noteLabel, octaveOf, pitchClass,
  romanNumeral, scaleNotes, intervalName, isBlackKey,
} from './chords';

/** Helper: build MIDI notes from a root and semitone offsets. */
const chord = (root: number, ...offsets: number[]) => offsets.map(o => root + o);

describe('note naming (Scientific Pitch Notation)', () => {
  it('places Middle C at MIDI 60 = C4', () => {
    expect(noteLabel(60)).toBe('C4');
    expect(octaveOf(60)).toBe(4);
  });

  it('names the MIDI range boundaries of an 88-key piano', () => {
    expect(noteLabel(21)).toBe('A0'); // lowest key
    expect(noteLabel(108)).toBe('C8'); // highest key
  });

  it('uses flats when asked', () => {
    expect(noteLabel(61, 'sharp')).toBe('C#4');
    expect(noteLabel(61, 'flat')).toBe('Db4');
  });

  it('wraps pitch classes correctly', () => {
    expect(pitchClass(60)).toBe(0);
    expect(pitchClass(71)).toBe(11);
    expect(pitchClass(0)).toBe(0);
  });

  it('identifies black keys', () => {
    expect(isBlackKey(61)).toBe(true); // C#
    expect(isBlackKey(60)).toBe(false); // C
    expect(isBlackKey(70)).toBe(true); // A#
  });
});

describe('equal temperament tuning (ISO 16)', () => {
  it('puts A4 at 440 Hz', () => {
    expect(frequencyOf(69)).toBeCloseTo(440, 6);
  });

  it('doubles frequency per octave', () => {
    expect(frequencyOf(81)).toBeCloseTo(880, 6);
    expect(frequencyOf(57)).toBeCloseTo(220, 6);
  });

  it('puts Middle C near 261.626 Hz', () => {
    expect(frequencyOf(60)).toBeCloseTo(261.6256, 3);
  });

  it('supports an alternate concert pitch', () => {
    expect(frequencyOf(69, 442)).toBeCloseTo(442, 6);
  });
});

describe('intervals', () => {
  it('names common intervals', () => {
    expect(intervalName(7)).toBe('Perfect 5th');
    expect(intervalName(3)).toBe('Minor 3rd');
    expect(intervalName(12)).toBe('Octave');
  });
});

describe('triad detection', () => {
  it('detects a C major triad', () => {
    const result = detectChord(chord(60, 0, 4, 7))!;
    expect(result.symbol).toBe('C');
    expect(result.quality).toBe('major');
    expect(result.exact).toBe(true);
    expect(result.inversion).toBe(0);
  });

  it('detects a D minor triad', () => {
    expect(detectChord(chord(62, 0, 3, 7))!.symbol).toBe('Dm');
  });

  it('detects diminished and augmented triads', () => {
    expect(detectChord(chord(59, 0, 3, 6))!.symbol).toBe('Bdim');
    expect(detectChord(chord(60, 0, 4, 8))!.symbol).toBe('Caug');
  });

  it('detects suspended chords', () => {
    expect(detectChord(chord(60, 0, 5, 7))!.symbol).toBe('Csus4');
    expect(detectChord(chord(60, 0, 2, 7))!.symbol).toBe('Csus2');
  });

  it('is octave-invariant — a widely spread C major is still C', () => {
    expect(detectChord([48, 64, 79])!.rootSymbol).toBe('C');
  });

  it('ignores doubled notes', () => {
    expect(detectChord([60, 64, 67, 72, 76])!.rootSymbol).toBe('C');
  });
});

describe('inversions and slash chords', () => {
  it('names first inversion C/E', () => {
    const result = detectChord([64, 67, 72])!; // E G C
    expect(result.symbol).toBe('C/E');
    expect(result.rootSymbol).toBe('C');
    expect(result.inversion).toBe(1);
    expect(result.inversionName).toBe('1st inversion');
  });

  it('names second inversion C/G', () => {
    const result = detectChord([67, 72, 76])!; // G C E
    expect(result.symbol).toBe('C/G');
    expect(result.inversion).toBe(2);
  });

  it('names a seventh chord in third inversion', () => {
    const result = detectChord([58, 60, 64, 67])!; // Bb C E G = C7/Bb
    expect(result.rootSymbol).toBe('C7');
    expect(result.inversion).toBe(3);
  });
});

describe('seventh and extended chords', () => {
  it('detects dominant, major and minor sevenths', () => {
    expect(detectChord(chord(60, 0, 4, 7, 10))!.symbol).toBe('C7');
    expect(detectChord(chord(60, 0, 4, 7, 11))!.symbol).toBe('Cmaj7');
    expect(detectChord(chord(62, 0, 3, 7, 10))!.symbol).toBe('Dm7');
  });

  it('detects half-diminished and fully diminished sevenths', () => {
    expect(detectChord(chord(59, 0, 3, 6, 10))!.symbol).toBe('Bm7b5');
    expect(detectChord(chord(59, 0, 3, 6, 9))!.symbol).toBe('Bdim7');
  });

  it('detects sixth chords', () => {
    expect(detectChord(chord(60, 0, 4, 7, 9))!.symbol).toBe('C6');
    expect(detectChord(chord(60, 0, 3, 7, 9))!.symbol).toBe('Cm6');
  });

  it('detects ninths', () => {
    expect(detectChord(chord(60, 0, 4, 7, 10, 14))!.symbol).toBe('C9');
    expect(detectChord(chord(60, 0, 4, 7, 11, 14))!.symbol).toBe('Cmaj9');
    expect(detectChord(chord(60, 0, 3, 7, 10, 14))!.symbol).toBe('Cm9');
  });

  it('detects altered dominants', () => {
    expect(detectChord(chord(60, 0, 4, 7, 10, 13))!.symbol).toBe('C7b9');
    expect(detectChord(chord(60, 0, 4, 7, 10, 15))!.symbol).toBe('C7#9');
  });

  it('detects add9 without a seventh', () => {
    expect(detectChord(chord(60, 0, 4, 7, 14))!.symbol).toBe('Cadd9');
  });

  it('reads a rootless-fifth voicing as the plain seventh chord', () => {
    // C E Bb — the 5th omitted, standard jazz shell voicing
    const result = detectChord([60, 64, 70])!;
    expect(result.rootSymbol).toBe('C7');
    expect(result.missing).toContain(7);
    expect(result.exact).toBe(false);
  });
});

describe('two-note input', () => {
  it('reports a fifth as a power chord or interval, not a triad', () => {
    const result = detectChord([60, 67])!;
    expect(result.symbol).toMatch(/^C( Perfect 5th|5)$/);
  });

  it('names a third as an interval', () => {
    expect(detectChord([60, 64])!.symbol).toBe('C Major 3rd');
  });

  it('returns null for fewer than two notes', () => {
    expect(detectChord([60])).toBeNull();
    expect(detectChord([])).toBeNull();
  });

  it('returns null when one pitch class is merely doubled', () => {
    expect(detectChord([60, 72])).toBeNull();
  });
});

describe('key context and Roman numerals', () => {
  it('builds the C major scale', () => {
    expect(scaleNotes(0, 'major')).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('builds the A natural minor scale', () => {
    expect(scaleNotes(9, 'minor')).toEqual([9, 11, 0, 2, 4, 5, 7]);
  });

  it('analyses a I-IV-V progression in C major', () => {
    const key = 0;
    expect(romanNumeral(detectChord(chord(60, 0, 4, 7))!, key, 'major')).toBe('I');
    expect(romanNumeral(detectChord(chord(65, 0, 4, 7))!, key, 'major')).toBe('IV');
    expect(romanNumeral(detectChord(chord(67, 0, 4, 7))!, key, 'major')).toBe('V');
  });

  it('lowercases minor-quality degrees', () => {
    expect(romanNumeral(detectChord(chord(62, 0, 3, 7))!, 0, 'major')).toBe('ii');
    expect(romanNumeral(detectChord(chord(69, 0, 3, 7))!, 0, 'major')).toBe('vi');
  });

  it('marks the diminished leading-tone triad', () => {
    expect(romanNumeral(detectChord(chord(71, 0, 3, 6))!, 0, 'major')).toBe('vii°');
  });

  it('adds figured-bass digits for inversions', () => {
    expect(romanNumeral(detectChord([64, 67, 72])!, 0, 'major')).toBe('I6');
    expect(romanNumeral(detectChord([67, 72, 76])!, 0, 'major')).toBe('I64');
  });

  it('marks a dominant seventh as V7', () => {
    expect(romanNumeral(detectChord(chord(67, 0, 4, 7, 10))!, 0, 'major')).toBe('V7');
  });

  it('returns null for a chord outside the key', () => {
    expect(romanNumeral(detectChord(chord(61, 0, 4, 7))!, 0, 'major')).toBeNull();
  });
});
