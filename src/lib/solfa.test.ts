import { describe, expect, it } from 'vitest';
import { doPitchClass, labelNote, labelNotes, numberOf, solfaOf } from './solfa';

const C_MAJOR = { keyRoot: 0, mode: 'major' as const, accidental: 'sharp' as const };

describe('solfaOf', () => {
  it('sings the major scale', () => {
    const scale = [60, 62, 64, 65, 67, 69, 71].map(n => solfaOf(n, 0, 'major', 'sharp'));
    expect(scale).toEqual(['do', 're', 'mi', 'fa', 'sol', 'la', 'ti']);
  });

  it('moves do with the key', () => {
    // In G, the note G is do and D is sol.
    expect(solfaOf(67, 7, 'major', 'sharp')).toBe('do');
    expect(solfaOf(62, 7, 'major', 'sharp')).toBe('sol');
  });

  it('starts a minor key on la, as tonic sol-fa teaches it', () => {
    const scale = [57, 59, 60, 62, 64, 65, 67].map(n => solfaOf(n, 9, 'minor', 'sharp'));
    expect(scale).toEqual(['la', 'ti', 'do', 're', 'mi', 'fa', 'sol']);
  });

  it('gives a minor key the same syllables as its relative major', () => {
    // A minor and C major share every note, so they must share every syllable.
    for (let note = 48; note < 60; note += 1) {
      expect(solfaOf(note, 9, 'minor', 'sharp')).toBe(solfaOf(note, 0, 'major', 'sharp'));
    }
  });

  it('raises syllables when spelling with sharps', () => {
    expect(solfaOf(61, 0, 'major', 'sharp')).toBe('di');
    expect(solfaOf(66, 0, 'major', 'sharp')).toBe('fi');
  });

  it('lowers syllables when spelling with flats', () => {
    expect(solfaOf(61, 0, 'major', 'flat')).toBe('ra');
    expect(solfaOf(70, 0, 'major', 'flat')).toBe('te');
  });

  it('is the same in every octave', () => {
    expect(solfaOf(36, 0, 'major', 'sharp')).toBe(solfaOf(84, 0, 'major', 'sharp'));
  });
});

describe('doPitchClass', () => {
  it('is the key note in major', () => {
    expect(doPitchClass(7, 'major')).toBe(7);
  });

  it('is a minor third above the key note in minor', () => {
    expect(doPitchClass(9, 'minor')).toBe(0);
  });
});

describe('numberOf', () => {
  it('counts from the key note', () => {
    expect([60, 64, 67].map(n => numberOf(n, 0))).toEqual(['1', '3', '5']);
  });

  it('keeps the key note as 1 in a minor key', () => {
    expect(numberOf(57, 9)).toBe('1');
    expect(numberOf(60, 9)).toBe('♭3');
  });
});

describe('labelNote', () => {
  it('gives the letter name when asked for names', () => {
    expect(labelNote(61, 'names', C_MAJOR)).toBe('C#');
    expect(labelNote(61, 'names', { ...C_MAJOR, accidental: 'flat' })).toBe('Db');
  });

  it('switches between the three ways of saying one note', () => {
    expect(labelNote(67, 'names', C_MAJOR)).toBe('G');
    expect(labelNote(67, 'solfa', C_MAJOR)).toBe('sol');
    expect(labelNote(67, 'numbers', C_MAJOR)).toBe('5');
  });
});

describe('labelNotes', () => {
  it('reads a chord from the bottom up', () => {
    expect(labelNotes([67, 60, 64], 'solfa', C_MAJOR)).toEqual(['do', 'mi', 'sol']);
  });

  it('says a doubled note once', () => {
    expect(labelNotes([48, 60, 64, 67, 72], 'names', C_MAJOR)).toEqual(['C', 'E', 'G']);
  });

  it('keeps the bass note first, so an inversion reads as one', () => {
    expect(labelNotes([64, 67, 72], 'numbers', C_MAJOR)).toEqual(['3', '5', '1']);
  });

  it('says nothing when nothing is sounding', () => {
    expect(labelNotes([], 'solfa', C_MAJOR)).toEqual([]);
  });

  it('takes a set as readily as a list', () => {
    expect(labelNotes(new Set([60, 67]), 'solfa', C_MAJOR)).toEqual(['do', 'sol']);
  });
});
