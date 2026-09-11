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
  it('finds common tempos on a click track', () => {
    for (const bpm of [90, 120, 140]) {
      const result = detectTempo(clickTrack(bpm, 12), 22050);
      // Half and double time are musically valid readings of the same pulse.
      const ratio = result.bpm / bpm;
      const acceptable = [0.5, 1, 2].some(factor => Math.abs(ratio - factor) < 0.06);
      expect(acceptable, `detected ${result.bpm} for a ${bpm} bpm track`).toBe(true);
    }
  });

  it('is confident about a steady pulse', () => {
    expect(detectTempo(clickTrack(120, 12), 22050).confidence).toBeGreaterThan(0.3);
  });

  it('is not confident about noise', () => {
    const noise = new Float32Array(22050 * 8);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
    expect(detectTempo(noise, 22050).confidence).toBeLessThan(0.5);
  });

  it('offers half and double time as alternatives', () => {
    const result = detectTempo(clickTrack(120, 12), 22050);
    expect(result.alternatives.length).toBeGreaterThan(0);
    result.alternatives.forEach(bpm => {
      expect(bpm).toBeGreaterThanOrEqual(60);
      expect(bpm).toBeLessThanOrEqual(200);
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
