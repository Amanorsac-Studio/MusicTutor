import { describe, expect, it } from 'vitest';

/**
 * The overlap-add window is the part of time stretching most likely to go
 * wrong, and the failure — an amplitude wobble at the grain rate — is easy to
 * hear but easy to miss when reading the code. These check the shape directly.
 */

/** The triangular window the player schedules for each grain. */
function windowAt(offsetInGrain: number, grain: number): number {
  if (offsetInGrain <= 0 || offsetInGrain >= grain) return 0;
  const half = grain / 2;
  return offsetInGrain <= half ? offsetInGrain / half : (grain - offsetInGrain) / half;
}

/** A window with a flat top, which is what the first implementation used. */
function flatTopWindow(offsetInGrain: number, grain: number, overlap: number): number {
  if (offsetInGrain <= 0 || offsetInGrain >= grain) return 0;
  const fade = grain * overlap * 0.5;
  if (offsetInGrain < fade) return offsetInGrain / fade;
  if (offsetInGrain > grain - fade) return (grain - offsetInGrain) / fade;
  return 1;
}

/** Sum every overlapping grain contributing at a point in output time. */
function overlapSum(time: number, grain: number, hop: number, shape: (o: number, g: number) => number): number {
  let total = 0;
  for (let start = Math.floor((time - grain) / hop) * hop; start <= time; start += hop) {
    total += shape(time - start, grain);
  }
  return total;
}

const GRAIN = 0.12;
const HOP = GRAIN / 2;

describe('grain window', () => {
  it('sums to one across the output, so the level never wobbles', () => {
    for (let time = GRAIN * 4; time < GRAIN * 6; time += 0.001) {
      expect(overlapSum(time, GRAIN, HOP, windowAt)).toBeCloseTo(1, 5);
    }
  });

  it('shows why a flat-topped window was wrong', () => {
    // The original window held 1 through the middle, so overlapping pairs
    // exceeded unity and modulated the amplitude at the grain rate.
    let peak = 0;
    let trough = Infinity;
    for (let time = GRAIN * 4; time < GRAIN * 6; time += 0.001) {
      const sum = overlapSum(time, GRAIN, HOP, (o, g) => flatTopWindow(o, g, 0.5));
      peak = Math.max(peak, sum);
      trough = Math.min(trough, sum);
    }
    expect(peak).toBeGreaterThan(1.2);
    expect(peak - trough).toBeGreaterThan(0.2);
  });

  it('reaches full level only at the grain centre', () => {
    expect(windowAt(GRAIN / 2, GRAIN)).toBeCloseTo(1, 6);
    expect(windowAt(GRAIN / 4, GRAIN)).toBeCloseTo(0.5, 6);
  });

  it('is silent at both edges, so grains never click', () => {
    expect(windowAt(0, GRAIN)).toBe(0);
    expect(windowAt(GRAIN, GRAIN)).toBe(0);
  });
});

describe('when stretching applies', () => {
  /** The player only takes the granular path when the speed is not normal. */
  const usesGranular = (speed: number) => Math.abs(speed - 1) > 0.005;

  it('plays the file untouched at normal speed', () => {
    // Graining audio that needs no stretching can only degrade it.
    expect(usesGranular(1)).toBe(false);
    expect(usesGranular(1.001)).toBe(false);
  });

  it('stretches at every practice speed', () => {
    [0.5, 0.6, 0.7, 0.8, 0.9].forEach(speed => expect(usesGranular(speed)).toBe(true));
  });
});
