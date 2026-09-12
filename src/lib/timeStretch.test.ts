import { describe, expect, it } from 'vitest';
import {
  bestOffset, computePeaks, hannWindow, peaksFor, renderPlan, similarity,
  stretchChannel, stretchChannels, stretchedLength,
} from './timeStretch';

/** A steady tone, which is the hardest case for a stretcher to keep clean. */
function tone(seconds: number, frequency: number, sampleRate = 44100): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return out;
}

/** Root mean square, as a stand-in for how loud something is. */
const rms = (x: Float32Array, from = 0, to = x.length): number => {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += x[i] * x[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

describe('hannWindow', () => {
  it('starts and ends at nothing', () => {
    const window = hannWindow(64);
    expect(window[0]).toBeCloseTo(0, 6);
    expect(window[32]).toBeCloseTo(1, 6);
  });

  it('sums to one when two overlap by half, which is what stops it pumping', () => {
    const length = 64;
    const window = hannWindow(length);
    for (let i = 0; i < length / 2; i += 1) {
      expect(window[i] + window[i + length / 2]).toBeCloseTo(1, 6);
    }
  });
});

describe('similarity', () => {
  it('is one for a stretch of waveform against itself', () => {
    const x = tone(0.05, 440);
    expect(similarity(x, 100, x, 100, 256)).toBeCloseTo(1, 5);
  });

  it('is minus one against its own inverse', () => {
    const x = tone(0.05, 440);
    const inverted = x.map(v => -v);
    expect(similarity(x, 100, inverted, 100, 256)).toBeCloseTo(-1, 5);
  });

  it('ignores loudness and compares shape', () => {
    const x = tone(0.05, 440);
    const quiet = x.map(v => v * 0.01);
    expect(similarity(x, 100, quiet, 100, 256)).toBeCloseTo(1, 5);
  });

  it('is zero when one side is silent', () => {
    const x = tone(0.05, 440);
    expect(similarity(x, 100, new Float32Array(512), 0, 256)).toBe(0);
  });
});

describe('bestOffset', () => {
  it('finds the shift that lines a waveform back up', () => {
    const sampleRate = 44100;
    const x = tone(0.2, 200, sampleRate);
    // One period of a 200 Hz tone at 44.1 kHz is about 220 samples, so a grain
    // taken 60 samples late lines up again if pulled back by 60.
    const target = x.slice(4000, 4000 + 256);
    const offset = bestOffset(x, 4060, target, 128, 256);
    expect(Math.abs(offset + 60)).toBeLessThanOrEqual(2);
  });

  it('stays put when the ideal position is already the best', () => {
    const x = tone(0.2, 200);
    const target = x.slice(4000, 4000 + 256);
    expect(Math.abs(bestOffset(x, 4000, target, 128, 256))).toBeLessThanOrEqual(2);
  });

  it('never wanders outside the tolerance it was given', () => {
    const x = tone(0.2, 200);
    const target = x.slice(9000, 9000 + 256);
    expect(Math.abs(bestOffset(x, 4000, target, 64, 256))).toBeLessThanOrEqual(64);
  });

  it('does nothing when it is allowed no room', () => {
    const x = tone(0.2, 200);
    expect(bestOffset(x, 4000, x.slice(0, 256), 0, 256)).toBe(0);
  });
});

describe('stretchedLength', () => {
  it('lengthens for a factor above one and shortens below it', () => {
    expect(stretchedLength(1000, 2)).toBe(2000);
    expect(stretchedLength(1000, 0.5)).toBe(500);
    expect(stretchedLength(1000, 1)).toBe(1000);
  });
});

describe('stretchChannel', () => {
  it('leaves audio completely alone at normal speed', () => {
    const x = tone(0.1, 440);
    const out = stretchChannel(x, 1);
    expect(out.length).toBe(x.length);
    expect(out[500]).toBe(x[500]);
  });

  it('produces the asked-for length', () => {
    const x = tone(0.5, 440);
    expect(stretchChannel(x, 1.5).length).toBe(stretchedLength(x.length, 1.5));
    expect(stretchChannel(x, 0.75).length).toBe(stretchedLength(x.length, 0.75));
  });

  it('keeps the pitch when it slows the audio down', () => {
    const sampleRate = 44100;
    const frequency = 300;
    const out = stretchChannel(tone(1, frequency, sampleRate), 1.5);
    // Count zero crossings in the settled middle; pitch is crossings per second
    // over two, and a stretcher that transposed would get this badly wrong.
    let crossings = 0;
    const from = Math.round(sampleRate * 0.3);
    const to = Math.round(sampleRate * 0.9);
    for (let i = from + 1; i < to; i += 1) {
      if ((out[i - 1] < 0) !== (out[i] < 0)) crossings += 1;
    }
    const measured = (crossings / 2) * (sampleRate / (to - from));
    expect(measured).toBeGreaterThan(frequency * 0.95);
    expect(measured).toBeLessThan(frequency * 1.05);
  });

  it('keeps the pitch when it speeds the audio up', () => {
    const sampleRate = 44100;
    const frequency = 300;
    const out = stretchChannel(tone(1, frequency, sampleRate), 0.7);
    let crossings = 0;
    const from = Math.round(sampleRate * 0.2);
    const to = Math.round(sampleRate * 0.6);
    for (let i = from + 1; i < to; i += 1) {
      if ((out[i - 1] < 0) !== (out[i] < 0)) crossings += 1;
    }
    const measured = (crossings / 2) * (sampleRate / (to - from));
    expect(measured).toBeGreaterThan(frequency * 0.95);
    expect(measured).toBeLessThan(frequency * 1.05);
  });

  it('holds a steady level rather than wobbling, which was the old fault', () => {
    const sampleRate = 44100;
    const out = stretchChannel(tone(1, 300, sampleRate), 1.4);
    // Sample the loudness across the settled middle. Overlap-add that cancels
    // out of phase shows up here as a level that rises and falls.
    const levels: number[] = [];
    for (let at = 0.25; at < 0.9; at += 0.05) {
      const from = Math.round(out.length * at);
      levels.push(rms(out, from, from + 2048));
    }
    const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
    const spread = Math.max(...levels) - Math.min(...levels);
    expect(mean).toBeGreaterThan(0.3);
    expect(spread / mean).toBeLessThan(0.25);
  });

  it('does not clip what it is given', () => {
    const out = stretchChannel(tone(0.4, 220), 1.6);
    expect(Math.max(...out)).toBeLessThan(1.3);
    expect(Math.min(...out)).toBeGreaterThan(-1.3);
  });

  it('handles silence without producing anything odd', () => {
    const out = stretchChannel(new Float32Array(44100), 1.5);
    expect(out.every(v => v === 0)).toBe(true);
  });

  it('refuses a nonsense factor instead of hanging', () => {
    const x = tone(0.05, 440);
    expect(stretchChannel(x, 0).length).toBe(x.length);
    expect(stretchChannel(x, Number.NaN).length).toBe(x.length);
  });

  it('reports progress and finishes at one', () => {
    const seen: number[] = [];
    stretchChannel(tone(1, 440), 1.5, { onProgress: f => seen.push(f) });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.every(f => f >= 0 && f <= 1)).toBe(true);
  });
});

describe('stretchChannels', () => {
  it('stretches both sides of a stereo track to the same length', () => {
    const left = tone(0.3, 220);
    const right = tone(0.3, 330);
    const out = stretchChannels([left, right], 1.4);
    expect(out).toHaveLength(2);
    expect(out[0].length).toBe(out[1].length);
  });

  it('reports progress once, not once per channel', () => {
    const seen: number[] = [];
    stretchChannels([tone(0.4, 220), tone(0.4, 330)], 1.3, { onProgress: f => seen.push(f) });
    // Exactly one run of progress means exactly one final 1.
    expect(seen.filter(f => f === 1)).toHaveLength(1);
  });
});

describe('renderPlan', () => {
  it('only stretches when nothing is transposed', () => {
    const plan = renderPlan(0.7, 0);
    expect(plan.rate).toBeCloseTo(1, 6);
    expect(plan.factor).toBeCloseTo(1 / 0.7, 6);
  });

  it('cancels the time change a transposition would cause', () => {
    const plan = renderPlan(1, 2);
    // Playing faster to raise the pitch shortens the track; the stretch has to
    // put that time back, so the two multiply out to no change.
    expect(plan.factor * (1 / plan.rate)).toBeCloseTo(1, 6);
  });

  it('combines a slow-down with a transposition in one pass', () => {
    const plan = renderPlan(0.5, -3);
    const effectiveSpeed = plan.rate / plan.factor;
    expect(effectiveSpeed).toBeCloseTo(0.5, 6);
    expect(plan.rate).toBeCloseTo(Math.pow(2, -3 / 12), 6);
  });

  it('does nothing at all when neither is asked for', () => {
    const plan = renderPlan(1, 0);
    expect(plan.factor).toBeCloseTo(1, 6);
    expect(plan.rate).toBeCloseTo(1, 6);
  });

  it('refuses a speed that would take an age to render', () => {
    expect(renderPlan(0, 0).factor).toBeLessThanOrEqual(10);
    expect(renderPlan(100, 0).factor).toBeGreaterThan(0);
  });
});

describe('computePeaks', () => {
  it('returns one pair per bucket', () => {
    expect(computePeaks(tone(1, 440), 200)).toHaveLength(200);
  });

  it('brackets the waveform', () => {
    const peaks = computePeaks(tone(1, 440), 50);
    peaks.forEach(peak => {
      expect(peak.max).toBeLessThanOrEqual(1.001);
      expect(peak.min).toBeGreaterThanOrEqual(-1.001);
      expect(peak.max).toBeGreaterThanOrEqual(peak.min);
    });
  });

  it('shows silence as flat', () => {
    const peaks = computePeaks(new Float32Array(4410), 10);
    expect(peaks.every(p => p.min === 0 && p.max === 0)).toBe(true);
  });

  it('follows a fade', () => {
    const x = tone(1, 440);
    for (let i = 0; i < x.length; i += 1) x[i] *= 1 - i / x.length;
    const peaks = computePeaks(x, 20);
    expect(peaks[0].max).toBeGreaterThan(peaks[19].max);
  });

  it('copes with more buckets than samples', () => {
    expect(computePeaks(new Float32Array(10), 100)).toHaveLength(100);
  });
});

describe('peaksFor', () => {
  it('shows the loudest of the channels, so a quiet side does not flatten it', () => {
    const loud = tone(0.5, 220);
    const quiet = tone(0.5, 220).map(v => v * 0.1) as Float32Array;
    const peaks = peaksFor([quiet, loud], 20);
    expect(Math.max(...peaks.map(p => p.max))).toBeGreaterThan(0.5);
  });

  it('returns nothing for a track with no channels', () => {
    expect(peaksFor([], 20)).toEqual([]);
  });
});
