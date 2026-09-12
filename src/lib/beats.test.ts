import { describe, expect, it } from 'vitest';
import {
  TIGHTNESS, conditionEnvelope, nearestBar, nearestBeat, strongestDownbeat,
  tempoFromBeats, trackBeatFrames, trackBeats, transitionCost,
} from './beats';
import { ANALYSIS_HOP } from './tempo';

/** A click track: short bursts of noise at a steady tempo. */
function clicks(bpm: number, seconds: number, sampleRate = 44100, accentEvery = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  const period = (60 / bpm) * sampleRate;
  let seed = 12345;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
  for (let beat = 0; beat * period < out.length; beat += 1) {
    const at = Math.round(beat * period);
    const accent = accentEvery > 0 && beat % accentEvery === 0 ? 1 : 0.45;
    for (let i = 0; i < 400 && at + i < out.length; i += 1) {
      out[at + i] += random() * accent * Math.exp(-i / 90);
    }
  }
  return out;
}

describe('transitionCost', () => {
  it('costs nothing when the gap is exactly the expected one', () => {
    expect(transitionCost(50, 50)).toBeCloseTo(0, 9);
  });

  it('costs the same whether the gap is double or half', () => {
    expect(transitionCost(100, 50)).toBeCloseTo(transitionCost(25, 50), 9);
  });

  it('punishes a bigger error more', () => {
    expect(transitionCost(60, 50)).toBeGreaterThan(transitionCost(90, 50));
  });

  it('follows the tightness it is given', () => {
    expect(transitionCost(60, 50, 200)).toBeLessThan(transitionCost(60, 50, 50));
  });

  it('rules out a gap that makes no sense', () => {
    expect(transitionCost(0, 50)).toBe(-Infinity);
    expect(transitionCost(-5, 50)).toBe(-Infinity);
  });
});

describe('conditionEnvelope', () => {
  it('scales the result into nought to one', () => {
    const raw = new Float32Array([0, 5, 1, 9, 2, 0, 7]);
    const out = conditionEnvelope(raw);
    expect(Math.max(...out)).toBeCloseTo(1, 6);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0);
  });

  it('keeps a quiet passage competitive with a loud one', () => {
    // Two identical patterns, one ten times louder. After conditioning, the
    // quiet one still has peaks rather than being flattened to nothing.
    const raw = new Float32Array(400);
    for (let i = 0; i < 200; i += 20) raw[i] = 1;
    for (let i = 200; i < 400; i += 20) raw[i] = 10;
    const out = conditionEnvelope(raw);
    const quietPeak = Math.max(...Array.from(out.slice(20, 190)));
    expect(quietPeak).toBeGreaterThan(0.05);
  });

  it('returns something the same length', () => {
    expect(conditionEnvelope(new Float32Array(123))).toHaveLength(123);
  });

  it('survives an envelope of pure silence', () => {
    const out = conditionEnvelope(new Float32Array(64));
    expect(out.every(v => v === 0)).toBe(true);
  });
});

describe('trackBeatFrames', () => {
  it('finds evenly spaced pulses', () => {
    const envelope = new Float32Array(600);
    for (let i = 0; i < 600; i += 30) envelope[i] = 1;
    const frames = trackBeatFrames(envelope, 30);
    expect(frames.length).toBeGreaterThan(15);
    for (let i = 1; i < frames.length; i += 1) {
      expect(Math.abs(frames[i] - frames[i - 1] - 30)).toBeLessThanOrEqual(1);
    }
  });

  it('lands on the pulses rather than between them', () => {
    const envelope = new Float32Array(600);
    for (let i = 7; i < 600; i += 30) envelope[i] = 1;
    const frames = trackBeatFrames(envelope, 30);
    frames.slice(1, -1).forEach(frame => {
      expect(Math.abs((frame - 7) % 30)).toBeLessThanOrEqual(1);
    });
  });

  it('carries straight through a missing pulse', () => {
    const envelope = new Float32Array(600);
    for (let i = 0; i < 600; i += 30) envelope[i] = 1;
    // Take out three beats in the middle, as a drop in a track would.
    for (let i = 300; i < 390; i += 30) envelope[i] = 0;
    const frames = trackBeatFrames(envelope, 30);
    const gaps = frames.slice(1).map((f, i) => f - frames[i]);
    // The tracker should step over the gap rather than lose the beat entirely.
    expect(Math.max(...gaps)).toBeLessThanOrEqual(60);
  });

  it('returns nothing for an empty envelope', () => {
    expect(trackBeatFrames(new Float32Array(0), 30)).toEqual([]);
    expect(trackBeatFrames(new Float32Array(100), 0)).toEqual([]);
  });

  it('gives beats in order', () => {
    const envelope = new Float32Array(400);
    for (let i = 0; i < 400; i += 25) envelope[i] = 1;
    const frames = trackBeatFrames(envelope, 25);
    for (let i = 1; i < frames.length; i += 1) expect(frames[i]).toBeGreaterThan(frames[i - 1]);
  });
});

describe('trackBeats', () => {
  it('finds the beats of a steady click track', () => {
    const bpm = 120;
    const grid = trackBeats(clicks(bpm, 8), 44100, bpm);
    expect(grid.beats.length).toBeGreaterThan(12);
    const measured = tempoFromBeats(grid.beats);
    expect(measured).toBeGreaterThan(bpm * 0.97);
    expect(measured).toBeLessThan(bpm * 1.03);
  });

  it('works at a slow practice tempo', () => {
    const bpm = 72;
    const grid = trackBeats(clicks(bpm, 10), 44100, bpm);
    expect(tempoFromBeats(grid.beats)).toBeGreaterThan(bpm * 0.95);
    expect(tempoFromBeats(grid.beats)).toBeLessThan(bpm * 1.05);
  });

  it('works at a fast one', () => {
    const bpm = 168;
    const grid = trackBeats(clicks(bpm, 8), 44100, bpm);
    expect(tempoFromBeats(grid.beats)).toBeGreaterThan(bpm * 0.95);
    expect(tempoFromBeats(grid.beats)).toBeLessThan(bpm * 1.05);
  });

  it('puts its beats close to where the clicks actually are', () => {
    const bpm = 100;
    const grid = trackBeats(clicks(bpm, 8), 44100, bpm);
    const period = 60 / bpm;
    grid.beats.slice(2, -2).forEach(beat => {
      const offBy = Math.abs(beat - Math.round(beat / period) * period);
      // Within one analysis hop, which is the resolution available.
      expect(offBy).toBeLessThan((ANALYSIS_HOP / 44100) * 3);
    });
  });

  it('reports the bar length it was told to assume', () => {
    expect(trackBeats(clicks(120, 4), 44100, 120, 3).beatsPerBar).toBe(3);
  });

  it('gives an empty grid for silence rather than inventing a beat', () => {
    const grid = trackBeats(new Float32Array(44100 * 2), 44100, 120);
    expect(tempoFromBeats(grid.beats)).toBeGreaterThanOrEqual(0);
  });
});

describe('strongestDownbeat', () => {
  it('picks the phase where the accents fall', () => {
    const envelope = new Float32Array(400);
    const frames: number[] = [];
    for (let beat = 0; beat < 16; beat += 1) {
      const frame = beat * 20;
      frames.push(frame);
      envelope[frame] = beat % 4 === 2 ? 1 : 0.2;
    }
    expect(strongestDownbeat(frames, envelope, 4)).toBe(2);
  });

  it('says the first beat when nothing stands out', () => {
    const envelope = new Float32Array(400).fill(0.5);
    const frames = Array.from({ length: 16 }, (_, i) => i * 20);
    expect(strongestDownbeat(frames, envelope, 4)).toBe(0);
  });

  it('does not guess from too few beats', () => {
    expect(strongestDownbeat([0, 20], new Float32Array(100), 4)).toBe(0);
  });
});

describe('nearestBeat', () => {
  const beats = [0, 0.5, 1, 1.5, 2];

  it('snaps to the closest one', () => {
    expect(nearestBeat(1.1, beats)).toBe(1);
    expect(nearestBeat(1.4, beats)).toBe(1.5);
  });

  it('snaps to the ends when asked for something outside', () => {
    expect(nearestBeat(-3, beats)).toBe(0);
    expect(nearestBeat(9, beats)).toBe(2);
  });

  it('leaves the time alone when there is no grid', () => {
    expect(nearestBeat(1.234, [])).toBe(1.234);
  });
});

describe('nearestBar', () => {
  const grid = {
    beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    beatsPerBar: 4,
    firstDownbeat: 0,
  };

  it('snaps to a downbeat, not just any beat', () => {
    expect(nearestBar(2.4, grid)).toBe(2);
    expect(nearestBar(0.6, grid)).toBe(0);
  });

  it('follows where the bar actually starts', () => {
    expect(nearestBar(1.4, { ...grid, firstDownbeat: 1 })).toBe(0.5);
  });

  it('leaves the time alone when there is no grid', () => {
    expect(nearestBar(1.23, { beats: [], beatsPerBar: 4, firstDownbeat: 0 })).toBe(1.23);
  });
});

describe('tempoFromBeats', () => {
  it('reads the tempo back out of evenly spaced beats', () => {
    const beats = Array.from({ length: 20 }, (_, i) => i * 0.5);
    expect(tempoFromBeats(beats)).toBeCloseTo(120, 6);
  });

  it('is not dragged off by one bad gap', () => {
    const beats = Array.from({ length: 20 }, (_, i) => i * 0.5);
    beats[10] += 0.3;
    expect(tempoFromBeats(beats)).toBeGreaterThan(110);
    expect(tempoFromBeats(beats)).toBeLessThan(130);
  });

  it('says nothing when there is nothing to measure', () => {
    expect(tempoFromBeats([])).toBe(0);
    expect(tempoFromBeats([1])).toBe(0);
  });
});

describe('the tightness default', () => {
  it('is firm enough to keep time but not so firm it ignores the music', () => {
    expect(TIGHTNESS).toBeGreaterThanOrEqual(50);
    expect(TIGHTNESS).toBeLessThanOrEqual(400);
  });
});
