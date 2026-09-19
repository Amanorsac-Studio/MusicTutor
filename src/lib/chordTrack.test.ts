import { describe, expect, it, vi } from 'vitest';
import {
  CHORD_SHAPES, PITCHED_THRESHOLD, binMap, chordAt, chordLabel, chordTemplate, normalise,
  peakiness, recogniseChords, scoreFrame, type ChordQuality, type ChordSegment,
} from './chordTrack';

// Seconds of synthesised audio per case; see the note in the tempo tests.
vi.setConfig({ testTimeout: 120_000 });

const RATE = 44100;

let seed = 4242;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return (seed / 0xffffffff) * 2 - 1;
};

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** One note with overtones, the way an instrument sounds rather than a sine. */
function addNote(out: Float32Array, at: number, seconds: number, midi: number, level: number) {
  const start = Math.round(at * RATE);
  const length = Math.round(seconds * RATE);
  for (let i = 0; i < length && start + i < out.length; i += 1) {
    const t = i / RATE;
    const envelope = Math.exp(-t * 1.2);
    let value = 0;
    for (let harmonic = 1; harmonic <= 6; harmonic += 1) {
      value += Math.sin(2 * Math.PI * hz(midi) * harmonic * t) / (harmonic * harmonic * 0.6 + 0.4);
    }
    out[start + i] += level * envelope * value;
  }
}

/**
 * A small band: chord in the middle, root in the bass, a drum hit on every
 * beat, and a melody note that is NOT in the chord brushing past, which is the
 * thing that tempts a recogniser into inventing sevenths.
 */
function band(
  chords: Array<{ root: number; quality: ChordQuality; beats: number }>, bpm = 100,
): { samples: Float32Array; beats: number[]; truth: Array<{ start: number; end: number; root: number; quality: ChordQuality }> } {
  const beat = 60 / bpm;
  const total = chords.reduce((sum, chord) => sum + chord.beats, 0);
  const samples = new Float32Array(Math.round((total * beat + 1) * RATE));
  const truth: Array<{ start: number; end: number; root: number; quality: ChordQuality }> = [];
  const beats: number[] = [];
  let at = 0;
  chords.forEach(chord => {
    const length = chord.beats * beat;
    CHORD_SHAPES[chord.quality].forEach(interval => addNote(samples, at, length, 60 + chord.root + interval, 0.12));
    addNote(samples, at, length, 36 + chord.root, 0.3);
    for (let b = 0; b < chord.beats; b += 1) {
      const t = at + b * beat;
      beats.push(t);
      const start = Math.round(t * RATE);
      for (let i = 0; i < 1500 && start + i < samples.length; i += 1) {
        samples[start + i] += random() * 0.25 * Math.exp(-i / 250);
      }
      // A passing melody note a step above the root, for one beat in four.
      if (b % 4 === 2) addNote(samples, t, beat * 0.45, 74 + chord.root, 0.05);
    }
    truth.push({ start: at, end: at + length, root: chord.root, quality: chord.quality });
    at += length;
  });
  return { samples, beats, truth };
}

/** Fraction of the time the recogniser and the truth agree. */
function agreement(
  segments: ChordSegment[],
  truth: Array<{ start: number; end: number; root: number; quality: ChordQuality }>,
  exactQuality: boolean,
): number {
  let right = 0;
  let total = 0;
  truth.forEach(actual => {
    for (let t = actual.start + 0.1; t < actual.end - 0.1; t += 0.1) {
      const heard = chordAt(segments, t);
      total += 1;
      if (heard && heard.root === actual.root && (!exactQuality || heard.quality === actual.quality)) right += 1;
    }
  });
  return right / Math.max(1, total);
}

describe('binMap', () => {
  it('sends concert A to pitch class nine', () => {
    const map = binMap(RATE, 8192, [430, 450]);
    const strongest = map.reduce((best, item) => (item.weight > best.weight ? item : best));
    expect(strongest.pitchClass).toBe(9);
  });

  it('trusts a bin on the semitone more than one between two', () => {
    const map = binMap(RATE, 8192, [200, 2000]);
    expect(Math.max(...map.map(item => item.weight))).toBeGreaterThan(0.95);
    expect(map.every(item => item.weight >= 0.05)).toBe(true);
  });

  it('follows a different tuning standard', () => {
    const at440 = binMap(RATE, 8192, [430, 450], 440);
    const at432 = binMap(RATE, 8192, [430, 450], 432);
    expect(at440).not.toEqual(at432);
  });
});

describe('chordTemplate', () => {
  it('is strongest on the notes of the chord', () => {
    const c = chordTemplate(0, 'maj');
    [0, 4, 7].forEach(pc => expect(c[pc]).toBeGreaterThan(c[1]));
  });

  it('has unit length, so chords compare fairly', () => {
    const t = chordTemplate(5, 'm7');
    expect(Math.sqrt(t.reduce((sum, v) => sum + v * v, 0))).toBeCloseTo(1, 6);
  });

  it('tells major from minor by the third', () => {
    expect(chordTemplate(0, 'maj')[4]).toBeGreaterThan(chordTemplate(0, 'min')[4]);
    expect(chordTemplate(0, 'min')[3]).toBeGreaterThan(chordTemplate(0, 'maj')[3]);
  });
});

describe('scoreFrame', () => {
  it('uses the bass to choose between chords that share their notes', () => {
    // C E G B is both Cmaj7 and, minus the C, E minor. The bass decides.
    const harmony = new Float32Array(12);
    [0, 4, 7, 11].forEach(pc => { harmony[pc] = 1; });
    const bassOnC = new Float32Array(12); bassOnC[0] = 1;
    const bassOnE = new Float32Array(12); bassOnE[4] = 1;
    const top = (scores: Float32Array) => scores.indexOf(Math.max(...scores));
    expect(top(scoreFrame(harmony, bassOnC))).not.toBe(top(scoreFrame(harmony, bassOnE)));
  });

  it('gives nothing for silence', () => {
    const scores = scoreFrame(new Float32Array(12), new Float32Array(12));
    expect(Math.max(...scores)).toBe(0);
  });
});

describe('peakiness', () => {
  it('is near one for noise, where every pitch class is equally strong', () => {
    expect(peakiness(new Float32Array(12).fill(0.5))).toBeCloseTo(1, 6);
  });

  it('is well above the threshold for a chord', () => {
    const chord = new Float32Array(12);
    [0, 4, 7].forEach(pc => { chord[pc] = 1; });
    expect(peakiness(chord)).toBeGreaterThan(PITCHED_THRESHOLD * 2);
  });

  it('is zero for silence', () => {
    expect(peakiness(new Float32Array(12))).toBe(0);
  });
});

describe('normalise', () => {
  it('scales the peak to one', () => {
    expect(Math.max(...normalise(new Float32Array([2, 4, 1])))).toBeCloseTo(1, 6);
  });

  it('leaves silence alone', () => {
    expect([...normalise(new Float32Array(3))]).toEqual([0, 0, 0]);
  });
});

describe('recogniseChords', () => {
  it('follows a four-chord song', () => {
    const song = band([
      { root: 0, quality: 'maj', beats: 4 },
      { root: 7, quality: 'maj', beats: 4 },
      { root: 9, quality: 'min', beats: 4 },
      { root: 5, quality: 'maj', beats: 4 },
      { root: 0, quality: 'maj', beats: 4 },
    ]);
    const segments = recogniseChords(song.samples, RATE, song.beats);
    expect(agreement(segments, song.truth, true)).toBeGreaterThan(0.9);
  });

  it('gets the roots right in a minor key', () => {
    const song = band([
      { root: 9, quality: 'min', beats: 4 },
      { root: 2, quality: 'min', beats: 4 },
      { root: 4, quality: 'maj', beats: 4 },
      { root: 9, quality: 'min', beats: 4 },
    ]);
    const segments = recogniseChords(song.samples, RATE, song.beats);
    expect(agreement(segments, song.truth, false)).toBeGreaterThan(0.9);
  });

  it('hears a seventh when one is really there', () => {
    const song = band([
      { root: 2, quality: 'm7', beats: 4 },
      { root: 7, quality: '7', beats: 4 },
      { root: 0, quality: 'maj7', beats: 8 },
    ]);
    const segments = recogniseChords(song.samples, RATE, song.beats);
    expect(agreement(segments, song.truth, false)).toBeGreaterThan(0.9);
    expect(agreement(segments, song.truth, true)).toBeGreaterThan(0.7);
  });

  it('does not invent sevenths on plain triads with a melody on top', () => {
    const song = band([
      { root: 5, quality: 'maj', beats: 8 },
      { root: 0, quality: 'maj', beats: 8 },
    ]);
    const segments = recogniseChords(song.samples, RATE, song.beats);
    expect(agreement(segments, song.truth, true)).toBeGreaterThan(0.85);
  });

  it('does not flicker: a steady chord comes back as one segment', () => {
    const song = band([{ root: 7, quality: 'maj', beats: 12 }]);
    const segments = recogniseChords(song.samples, RATE, song.beats).filter(s => s.root >= 0);
    expect(segments.length).toBeLessThanOrEqual(2);
  });

  it('follows quick changes, two beats to a chord', () => {
    const song = band([
      { root: 0, quality: 'maj', beats: 2 },
      { root: 5, quality: 'maj', beats: 2 },
      { root: 7, quality: 'maj', beats: 2 },
      { root: 0, quality: 'maj', beats: 2 },
      { root: 9, quality: 'min', beats: 2 },
      { root: 5, quality: 'maj', beats: 2 },
    ]);
    const segments = recogniseChords(song.samples, RATE, song.beats);
    expect(agreement(segments, song.truth, false)).toBeGreaterThan(0.85);
  });

  it('works without a beat grid, on fixed slices', () => {
    const song = band([
      { root: 0, quality: 'maj', beats: 8 },
      { root: 5, quality: 'maj', beats: 8 },
    ]);
    const segments = recogniseChords(song.samples, RATE, []);
    expect(agreement(segments, song.truth, false)).toBeGreaterThan(0.8);
  });

  it('calls silence silence rather than naming a chord', () => {
    const segments = recogniseChords(new Float32Array(RATE * 3), RATE, []);
    expect(segments.every(segment => segment.root === -1)).toBe(true);
  });

  it('returns nothing for a clip too short to analyse', () => {
    expect(recogniseChords(new Float32Array(1000), RATE, [])).toEqual([]);
  });

  it('covers the recording without gaps or overlaps', () => {
    const song = band([{ root: 0, quality: 'maj', beats: 4 }, { root: 7, quality: 'maj', beats: 4 }]);
    const segments = recogniseChords(song.samples, RATE, song.beats);
    for (let i = 1; i < segments.length; i += 1) {
      expect(segments[i].start).toBeCloseTo(segments[i - 1].end, 6);
    }
  });
});

describe('chordAt', () => {
  const segments: ChordSegment[] = [
    { start: 0, end: 2, root: 0, quality: 'maj' },
    { start: 2, end: 4, root: 7, quality: 'maj' },
  ];

  it('finds the chord at a moment', () => {
    expect(chordAt(segments, 1)?.root).toBe(0);
    expect(chordAt(segments, 2)?.root).toBe(7);
  });

  it('says nothing outside the recording', () => {
    expect(chordAt(segments, -1)).toBeNull();
    expect(chordAt(segments, 9)).toBeNull();
  });
});

describe('chordLabel', () => {
  it('names a chord in the spelling asked for', () => {
    expect(chordLabel({ root: 1, quality: 'min' }, 'sharp')).toBe('C#m');
    expect(chordLabel({ root: 1, quality: 'min' }, 'flat')).toBe('Dbm');
  });

  it('moves with a transposition, so the label matches what is heard', () => {
    expect(chordLabel({ root: 0, quality: 'maj7' }, 'sharp', 2)).toBe('Dmaj7');
    expect(chordLabel({ root: 0, quality: 'maj' }, 'sharp', -1)).toBe('B');
  });

  it('shows a dash where there is no chord', () => {
    expect(chordLabel({ root: -1, quality: null }, 'sharp')).toBe('—');
  });
});

describe('bestChord', () => {
  it('names a plain triad from its chroma', async () => {
    const { bestChord, chordTemplate } = await import('./chordTrack');
    const bass = new Float32Array(12);
    bass[9] = 1;
    expect(bestChord(chordTemplate(9, 'min'), bass)).toEqual({ root: 9, quality: 'min' });
  });

  it('says nothing about flat, unpitched sound', async () => {
    const { bestChord } = await import('./chordTrack');
    expect(bestChord(new Float32Array(12).fill(1), new Float32Array(12).fill(1))).toBeNull();
  });
});

describe('chordVoicing', () => {
  it('puts the root in the bass and the chord above it', async () => {
    const { chordVoicing } = await import('./chordTrack');
    expect(chordVoicing(0, 'maj')).toEqual([36, 60, 64, 67]);
  });

  it('keeps high roots from climbing off the middle of the keyboard', async () => {
    const { chordVoicing } = await import('./chordTrack');
    expect(chordVoicing(11, 'min')).toEqual([47, 59, 62, 66]);
  });

  it('follows the transposition', async () => {
    const { chordVoicing } = await import('./chordTrack');
    expect(chordVoicing(0, 'maj', 2)).toEqual([38, 62, 66, 69]);
  });
});

describe('estimateKey', () => {
  const seg = (start: number, end: number, root: number, quality: 'maj' | 'min') => ({ start, end, root, quality });

  it('finds C major from C Am F G', async () => {
    const { estimateKey } = await import('./chordTrack');
    expect(estimateKey([seg(0, 4, 0, 'maj'), seg(4, 8, 9, 'min'), seg(8, 12, 5, 'maj'), seg(12, 16, 7, 'maj'), seg(16, 20, 0, 'maj')]))
      .toEqual({ root: 0, mode: 'major' });
  });

  it('finds A minor when the song lives on Am and ends there', async () => {
    const { estimateKey } = await import('./chordTrack');
    expect(estimateKey([seg(0, 8, 9, 'min'), seg(8, 12, 2, 'min'), seg(12, 16, 4, 'maj'), seg(16, 24, 9, 'min')]))
      .toEqual({ root: 9, mode: 'minor' });
  });

  it('finds G major from G D Em C', async () => {
    const { estimateKey } = await import('./chordTrack');
    expect(estimateKey([seg(0, 4, 7, 'maj'), seg(4, 8, 2, 'maj'), seg(8, 12, 4, 'min'), seg(12, 16, 0, 'maj'), seg(16, 20, 7, 'maj')]))
      .toEqual({ root: 7, mode: 'major' });
  });

  it('gives a harmless answer for no chords at all', async () => {
    const { estimateKey } = await import('./chordTrack');
    expect(estimateKey([])).toEqual({ root: 0, mode: 'major' });
  });
});
