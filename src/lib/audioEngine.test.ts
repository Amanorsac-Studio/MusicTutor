import { describe, expect, it } from 'vitest';
import { dbToMeter, faderToGain, gainToDb, METER_FLOOR_DB } from './audioEngine';

describe('fader taper', () => {
  it('is silent at the bottom and unity at the top', () => {
    expect(faderToGain(0)).toBe(0);
    expect(faderToGain(1)).toBeCloseTo(1, 6);
  });

  it('increases monotonically', () => {
    let previous = -1;
    for (let position = 0; position <= 1.0001; position += 0.05) {
      const gain = faderToGain(position);
      expect(gain).toBeGreaterThanOrEqual(previous);
      previous = gain;
    }
  });

  it('puts the midpoint well below half gain, as a real console does', () => {
    const mid = faderToGain(0.5);
    expect(mid).toBeLessThan(0.35);
    expect(mid).toBeGreaterThan(0.1);
  });

  it('clamps positions above 1', () => {
    expect(faderToGain(2)).toBeCloseTo(1, 6);
  });
});

describe('gain and decibel conversion', () => {
  it('reports unity gain as 0 dB', () => {
    expect(gainToDb(1)).toBeCloseTo(0, 6);
  });

  it('reports half amplitude as about -6 dB', () => {
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 1);
  });

  it('reports silence as negative infinity', () => {
    expect(gainToDb(0)).toBe(-Infinity);
  });
});

describe('meter scaling', () => {
  it('puts full scale at the top and the noise floor at the bottom', () => {
    expect(dbToMeter(0)).toBeCloseTo(1, 6);
    expect(dbToMeter(METER_FLOOR_DB)).toBeCloseTo(0, 6);
  });

  it('clamps levels beyond the displayable range', () => {
    expect(dbToMeter(6)).toBe(1);
    expect(dbToMeter(-120)).toBe(0);
  });

  it('places -30 dBFS near the middle of the scale', () => {
    const mid = dbToMeter(-30);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});
