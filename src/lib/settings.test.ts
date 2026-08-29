import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, formatBytes, formatDuration, normalizeSettings } from './settings';

describe('settings normalisation', () => {
  it('returns defaults for junk input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps recognised values and drops unknown keys', () => {
    const result = normalizeSettings({ recordMidi: false, somethingElse: 'x' });
    expect(result.recordMidi).toBe(false);
    expect(result).not.toHaveProperty('somethingElse');
  });

  it('ignores values of the wrong type', () => {
    const result = normalizeSettings({ recordAudio: 'yes' });
    expect(result.recordAudio).toBe(DEFAULT_SETTINGS.recordAudio);
  });

  it('clamps concert pitch to a musically sane range', () => {
    expect(normalizeSettings({ concertPitch: 9000 }).concertPitch).toBe(466);
    expect(normalizeSettings({ concertPitch: 10 }).concertPitch).toBe(392);
    expect(normalizeSettings({ concertPitch: 442 }).concertPitch).toBe(442);
  });

  it('clamps levels to 0..1', () => {
    expect(normalizeSettings({ masterLevel: 5 }).masterLevel).toBe(1);
    expect(normalizeSettings({ monitorLevel: -2 }).monitorLevel).toBe(0);
  });

  it('wraps the key root into a pitch class', () => {
    expect(normalizeSettings({ keyRoot: 14 }).keyRoot).toBe(2);
    expect(normalizeSettings({ keyRoot: -1 }).keyRoot).toBe(11);
  });

  it('rejects an unknown quality preset', () => {
    expect(normalizeSettings({ quality: 'holographic' }).quality).toBe(DEFAULT_SETTINGS.quality);
    expect(normalizeSettings({ quality: '720p30' }).quality).toBe('720p30');
  });
});

describe('duration formatting', () => {
  it('formats as HH:MM:SS', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(65_000)).toBe('00:01:05');
    expect(formatDuration(3_661_000)).toBe('01:01:01');
  });

  it('keeps counting past 24 hours instead of wrapping', () => {
    // The previous implementation used Date#toISOString and silently wrapped here.
    expect(formatDuration(90_000_000)).toBe('25:00:00');
  });

  it('treats negative input as zero', () => {
    expect(formatDuration(-500)).toBe('00:00:00');
  });
});

describe('byte formatting', () => {
  it('uses KB, MB and GB as appropriate', () => {
    expect(formatBytes(500_000, 'en-US')).toMatch(/KB$/);
    expect(formatBytes(5_000_000, 'en-US')).toMatch(/MB$/);
    expect(formatBytes(5_000_000_000, 'en-US')).toMatch(/GB$/);
  });

  it('handles zero and invalid sizes', () => {
    expect(formatBytes(0, 'en-US')).toBe('0 MB');
    expect(formatBytes(Number.NaN, 'en-US')).toBe('0 MB');
  });

  it('respects the locale’s number formatting', () => {
    // German uses a comma as the decimal separator.
    expect(formatBytes(1_600_000, 'de-DE')).toContain(',');
    expect(formatBytes(1_600_000, 'en-US')).toContain('.');
  });
});
