import { describe, expect, it } from 'vitest';
import {
  COMPRESSION, ONSET_HOP, bandEdges, bandFlux, compressBands, onsetEnvelope, removeDrift,
} from './onsets';

const RATE = 44100;

/** A tone that starts partway through silence. */
function noteAt(startSeconds: number, frequency: number, seconds = 2): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  const from = Math.round(startSeconds * RATE);
  for (let i = from; i < out.length; i += 1) {
    out[i] = 0.5 * Math.sin((2 * Math.PI * frequency * (i - from)) / RATE);
  }
  return out;
}

describe('bandEdges', () => {
  it('starts near the bottom of hearing and climbs', () => {
    const edges = bandEdges(RATE, 2048);
    expect(edges.length).toBeGreaterThan(20);
    for (let i = 1; i < edges.length; i += 1) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
  });

  it('stays inside the bins the transform produced', () => {
    bandEdges(RATE, 2048).forEach(edge => expect(edge).toBeLessThan(1024));
  });

  it('spaces bands logarithmically, so pitch is treated evenly', () => {
    const edges = bandEdges(RATE, 4096, 12);
    // Higher up, a band covers more bins than one lower down.
    const low = edges[6] - edges[5];
    const high = edges[edges.length - 2] - edges[edges.length - 3];
    expect(high).toBeGreaterThan(low);
  });
});

describe('compressBands', () => {
  it('sums the bins inside each band', () => {
    const magnitudes = new Float64Array([1, 1, 1, 1, 1, 1]);
    const out = new Float64Array(2);
    compressBands(magnitudes, [0, 2, 4], out);
    expect(out[0]).toBeCloseTo(Math.log(1 + COMPRESSION * 2), 9);
  });

  it('compresses, so a loud band is not thousands of times a quiet one', () => {
    const out = new Float64Array(2);
    compressBands(new Float64Array([0.001, 1]), [0, 1, 2], out);
    expect(out[1] / out[0]).toBeLessThan(10);
  });
});

describe('bandFlux', () => {
  it('counts energy appearing', () => {
    expect(bandFlux(new Float64Array([2, 2]), new Float64Array([1, 1]), 0)).toBeCloseTo(2, 9);
  });

  it('ignores energy fading, because a note ending is not a note starting', () => {
    expect(bandFlux(new Float64Array([1, 1]), new Float64Array([2, 2]), 0)).toBe(0);
  });

  it('ignores a pitch sliding between neighbouring bands', () => {
    // The same energy, moved one band along: vibrato, not an attack.
    const previous = new Float64Array([0, 5, 0, 0]);
    const current = new Float64Array([0, 0, 5, 0]);
    expect(bandFlux(current, previous, 1)).toBe(0);
    // Without the maximum filter it would have looked like a full-strength onset.
    expect(bandFlux(current, previous, 0)).toBeCloseTo(5, 9);
  });

  it('still catches a real attack while ignoring the slide', () => {
    const previous = new Float64Array([0, 5, 0, 0]);
    const current = new Float64Array([0, 0, 9, 0]);
    expect(bandFlux(current, previous, 1)).toBeCloseTo(4, 9);
  });
});

describe('onsetEnvelope', () => {
  it('peaks where the note begins', () => {
    const envelope = onsetEnvelope(noteAt(1, 440), RATE);
    const framesPerSecond = RATE / ONSET_HOP;
    const peakFrame = [...envelope].indexOf(Math.max(...envelope));
    expect(peakFrame / framesPerSecond).toBeGreaterThan(0.9);
    expect(peakFrame / framesPerSecond).toBeLessThan(1.15);
  });

  it('stays quiet while a note is merely continuing', () => {
    const envelope = onsetEnvelope(noteAt(0.5, 440, 3), RATE);
    const framesPerSecond = RATE / ONSET_HOP;
    const settled = [...envelope].slice(Math.round(framesPerSecond * 1.5));
    expect(Math.max(...settled)).toBeLessThan(0.3);
  });

  it('finds a quiet note starting over a loud sustained one', () => {
    // The case a loudness-based detector cannot do: the total level hardly
    // moves, but a new pitch appears.
    const seconds = 3;
    const out = new Float32Array(Math.round(seconds * RATE));
    for (let i = 0; i < out.length; i += 1) {
      out[i] = 0.6 * Math.sin((2 * Math.PI * 220 * i) / RATE);
    }
    const from = Math.round(1.5 * RATE);
    for (let i = from; i < out.length; i += 1) {
      out[i] += 0.12 * Math.sin((2 * Math.PI * 880 * (i - from)) / RATE);
    }
    const envelope = onsetEnvelope(out, RATE);
    const framesPerSecond = RATE / ONSET_HOP;
    const around = (seconds_: number) => {
      const at = Math.round(seconds_ * framesPerSecond);
      return Math.max(...[...envelope].slice(at - 8, at + 8));
    };
    expect(around(1.5)).toBeGreaterThan(around(1.0) * 3);
  });

  it('normalises to a peak of one', () => {
    const envelope = onsetEnvelope(noteAt(1, 440), RATE);
    expect(Math.max(...envelope)).toBeCloseTo(1, 6);
  });

  it('returns nothing for audio too short to analyse', () => {
    expect(onsetEnvelope(new Float32Array(100), RATE)).toHaveLength(0);
  });

  it('returns silence for silence rather than noise', () => {
    const envelope = onsetEnvelope(new Float32Array(RATE), RATE);
    expect([...envelope].every(value => value === 0)).toBe(true);
  });
});

describe('removeDrift', () => {
  it('keeps a quiet passage competitive with a loud one', () => {
    const raw = new Float32Array(400);
    for (let i = 0; i < 200; i += 20) raw[i] = 1;
    for (let i = 200; i < 400; i += 20) raw[i] = 10;
    const out = removeDrift(raw);
    const quietPeak = Math.max(...Array.from(out.slice(20, 190)));
    expect(quietPeak).toBeGreaterThan(0.05);
  });

  it('never goes negative', () => {
    const out = removeDrift(new Float32Array([0, 5, 0, 0, 9, 0, 1]));
    expect([...out].every(value => value >= 0)).toBe(true);
  });

  it('leaves the length alone', () => {
    expect(removeDrift(new Float32Array(123))).toHaveLength(123);
  });

  it('handles silence without dividing by nothing', () => {
    expect([...removeDrift(new Float32Array(64))].every(v => v === 0)).toBe(true);
  });
});
