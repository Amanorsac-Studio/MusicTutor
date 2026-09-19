import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ChordSmoother } from './liveListen';
import { chordTemplate } from './chordTrack';

const bassOn = (root: number) => {
  const bass = new Float32Array(12);
  bass[root] = 1;
  return bass;
};

const feed = (smoother: ChordSmoother, root: number, quality: 'maj' | 'min', frames: number) => {
  let heard = null;
  for (let i = 0; i < frames; i += 1) heard = smoother.push(chordTemplate(root, quality), bassOn(root), true);
  return heard;
};

describe('ChordSmoother', () => {
  it('names a chord once it has been heard a few times running', () => {
    const smoother = new ChordSmoother();
    expect(feed(smoother, 0, 'maj', 8)).toEqual({ root: 0, quality: 'maj' });
  });

  it('does not jump at a single stray frame', () => {
    const smoother = new ChordSmoother();
    feed(smoother, 0, 'maj', 12);
    expect(feed(smoother, 7, 'maj', 1)).toEqual({ root: 0, quality: 'maj' });
  });

  it('follows a real change', () => {
    const smoother = new ChordSmoother();
    feed(smoother, 0, 'maj', 12);
    expect(feed(smoother, 9, 'min', 30)).toEqual({ root: 9, quality: 'min' });
  });

  it('holds the chord through a short gap, then lets go in silence', () => {
    const smoother = new ChordSmoother();
    feed(smoother, 5, 'maj', 12);
    const quiet = new Float32Array(12);
    for (let i = 0; i < 4; i += 1) smoother.push(quiet, quiet, false);
    expect(smoother.push(quiet, quiet, false)).toEqual({ root: 5, quality: 'maj' });
    let heard = null;
    for (let i = 0; i < 12; i += 1) heard = smoother.push(quiet, quiet, false);
    expect(heard).toBeNull();
  });
});

/* The separation engine's arithmetic lives in the desktop shell, as CommonJS. */
const stems = createRequire(import.meta.url)('../../electron/stems.cjs') as {
  SEGMENT: number; OVERLAP: number; STRIDE: number;
  makeWindow: () => Float32Array;
  chunkCount: (total: number) => number;
  encodeWav: (left: Float32Array, right: Float32Array) => Uint8Array & { readInt16LE: (at: number) => number; readUInt32LE: (at: number) => number };
  fingerprint: (left: Float32Array, right: Float32Array) => string;
};

describe('stem chunking', () => {
  it('cross-fades so overlapping pieces add up to a constant', () => {
    const window = stems.makeWindow();
    // Where piece two fades in over piece one fading out.
    for (const i of [0, 1, 1000, stems.OVERLAP - 1]) {
      expect(window[stems.STRIDE + i] + window[i]).toBeCloseTo(1, 5);
    }
    expect(window[stems.OVERLAP + 10]).toBe(1);
  });

  it('cuts enough pieces to cover the whole song', () => {
    expect(stems.chunkCount(1)).toBe(1);
    expect(stems.chunkCount(stems.STRIDE)).toBe(1);
    expect(stems.chunkCount(stems.STRIDE + 1)).toBe(2);
    const total = 44100 * 240;
    expect(stems.chunkCount(total) * stems.STRIDE).toBeGreaterThanOrEqual(total);
  });

  it('writes a well-formed stereo WAV and does not wrap loud samples', () => {
    const wav = stems.encodeWav(new Float32Array([0, 0.5, 2]), new Float32Array([0, -0.5, -2]));
    expect(wav.length).toBe(44 + 3 * 4);
    expect(wav.readUInt32LE(40)).toBe(12);
    expect(wav.readInt16LE(44 + 8)).toBe(32767);
    expect(wav.readInt16LE(44 + 10)).toBe(-32768);
  });

  it('fingerprints the sound, not the name', () => {
    const a = new Float32Array(50000).map((_, i) => Math.sin(i * 0.01));
    const b = new Float32Array(50000).map((_, i) => Math.sin(i * 0.011));
    expect(stems.fingerprint(a, a)).toBe(stems.fingerprint(a.slice(), a.slice()));
    expect(stems.fingerprint(a, a)).not.toBe(stems.fingerprint(b, b));
    expect(stems.fingerprint(a, a)).toMatch(/^[0-9a-f]{20}$/);
  });
});
