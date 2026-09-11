import { describe, expect, it } from 'vitest';
import { beatLength, beatPosition, detectTempo, onsetEnvelope, snapToBeat } from './tempo';

/** Synthesise a click track at a known tempo, to test detection against truth. */
function clickTrack(bpm: number, seconds: number, sampleRate = 22050, offset = 0): Float32Array {
  const samples = new Float32Array(Math.floor(sampleRate * seconds));
  const period = (60 / bpm) * sampleRate;
  for (let beat = 0; ; beat++) {
    const start = Math.floor(offset * sampleRate + beat * period);
    if (start >= samples.length) break;
    // A short percussive burst that decays, like a drum hit.
    for (let i = 0; i < 900 && start + i < samples.length; i++) {
      const decay = Math.exp(-i / 180);
      samples[start + i] += Math.sin((i / sampleRate) * 2 * Math.PI * 1200) * decay;
    }
  }
  return samples;
}

describe('onset envelope', () => {
  it('is empty-safe', () => {
    expect(onsetEnvelope(new Float32Array(0), 44100).length).toBe(0);
  });

  it('responds to attacks rather than steady tone', () => {
    const sampleRate = 22050;
    const steady = new Float32Array(sampleRate);
    for (let i = 0; i < steady.length; i++) steady[i] = Math.sin((i / sampleRate) * 2 * Math.PI * 440);
    const clicks = clickTrack(120, 1, sampleRate);

    const sum = (env: Float32Array) => env.reduce((total, value) => total + value, 0);
    // A constant sine has one onset at the very start; clicks have several.
    expect(sum(onsetEnvelope(clicks, sampleRate))).toBeGreaterThan(sum(onsetEnvelope(steady, sampleRate)));
  });

  it('normalises to a peak of 1', () => {
    const envelope = onsetEnvelope(clickTrack(100, 3), 22050);
    expect(Math.max(...envelope)).toBeCloseTo(1, 5);
  });
});

describe('tempo detection', () => {
  it('reads the actual tempo, not half or double it, across the usual range', () => {
    // Autocorrelation alone cannot separate a tempo from half of it. Weighting
    // toward the range music sits in is what makes these land correctly.
    for (const bpm of [65, 80, 90, 100, 110, 120, 128, 140, 150, 170]) {
      const result = detectTempo(clickTrack(bpm, 16, 44100), 44100);
      const error = Math.abs((result.bpm - bpm) / bpm) * 100;
      expect(error, `detected ${result.bpm} for a ${bpm} bpm track`).toBeLessThan(1);
    }
  });

  it('is accurate to a fraction of a percent, not a whole frame of lag', () => {
    // Whole-frame lags quantise the answer; the peak is interpolated to fix it.
    const result = detectTempo(clickTrack(120, 16, 44100), 44100);
    expect(Math.abs(result.bpm - 120)).toBeLessThan(1);
  });

  it('offers the other reading when a fast tempo is heard as half-time', () => {
    // 180 against 90 is a real musical ambiguity, so rather than pretend, the
    // alternative is always one click away.
    const result = detectTempo(clickTrack(180, 16, 44100), 44100);
    const candidates = [result.bpm, ...result.alternatives];
    expect(candidates.some(bpm => Math.abs(bpm - 180) < 3)).toBe(true);
  });

  it('is confident about a steady pulse', () => {
    expect(detectTempo(clickTrack(120, 16, 44100), 44100).confidence).toBeGreaterThan(0.3);
  });

  it('is not confident about noise', () => {
    const noise = new Float32Array(22050 * 8);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
    expect(detectTempo(noise, 22050).confidence).toBeLessThan(0.5);
  });

  it('offers half and double time as alternatives', () => {
    const result = detectTempo(clickTrack(120, 16, 44100), 44100);
    expect(result.alternatives.length).toBeGreaterThan(0);
    // Alternatives are manual corrections, so they are not held to the
    // detection range — 60 and 240 are both reasonable things to want.
    result.alternatives.forEach(bpm => {
      expect(bpm).toBeGreaterThanOrEqual(40);
      expect(bpm).toBeLessThanOrEqual(250);
    });
  });

  it('always reports a usable tempo, even for silence', () => {
    const result = detectTempo(new Float32Array(22050), 22050);
    expect(result.bpm).toBeGreaterThan(0);
    expect(Number.isFinite(result.bpm)).toBe(true);
  });

  it('handles input shorter than one analysis window', () => {
    expect(() => detectTempo(new Float32Array(64), 22050)).not.toThrow();
  });

  it('finds where the first beat falls', () => {
    const result = detectTempo(clickTrack(120, 12, 22050), 22050);
    expect(result.offset).toBeGreaterThanOrEqual(0);
    expect(result.offset).toBeLessThan(beatLength(result.bpm) + 0.05);
  });
});

describe('beat maths', () => {
  it('converts tempo to beat length', () => {
    expect(beatLength(120)).toBeCloseTo(0.5, 6);
    expect(beatLength(60)).toBeCloseTo(1, 6);
  });

  it('snaps a time to the nearest beat', () => {
    expect(snapToBeat(0.6, 120)).toBeCloseTo(0.5, 6);
    expect(snapToBeat(0.9, 120)).toBeCloseTo(1.0, 6);
  });

  it('respects a grid offset', () => {
    expect(snapToBeat(0.85, 120, 0.25)).toBeCloseTo(0.75, 6);
  });

  it('never snaps before zero', () => {
    expect(snapToBeat(-5, 120)).toBeGreaterThanOrEqual(0);
  });

  it('reports bars and beats from one', () => {
    expect(beatPosition(0, 120)).toEqual({ bar: 1, beat: 1 });
    expect(beatPosition(0.5, 120)).toEqual({ bar: 1, beat: 2 });
    expect(beatPosition(2, 120)).toEqual({ bar: 2, beat: 1 });
  });

  it('clamps times before the first beat to bar one', () => {
    expect(beatPosition(-1, 120)).toEqual({ bar: 1, beat: 1 });
  });
});
