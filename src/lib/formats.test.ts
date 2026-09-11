import { describe, expect, it } from 'vitest';
import {
  FORMAT_IDS, OUTPUT_FORMATS, QUALITY_LEVELS, RESOLUTIONS, bitrateFor,
  getFormat, getResolution, renderSize,
} from './formats';

describe('output formats', () => {
  it('offers landscape, portrait and square', () => {
    expect(FORMAT_IDS).toEqual(['landscape', 'portrait', 'square']);
  });

  it('uses the right shape for each platform', () => {
    expect(OUTPUT_FORMATS.landscape.width / OUTPUT_FORMATS.landscape.height).toBeCloseTo(16 / 9, 3);
    expect(OUTPUT_FORMATS.portrait.width / OUTPUT_FORMATS.portrait.height).toBeCloseTo(9 / 16, 3);
    expect(OUTPUT_FORMATS.square.width).toBe(OUTPUT_FORMATS.square.height);
  });

  it('falls back to landscape for an unknown id', () => {
    expect(getFormat('nonsense').id).toBe('landscape');
    expect(getFormat(undefined).id).toBe('landscape');
    expect(getFormat('portrait').id).toBe('portrait');
  });
});

describe('render size', () => {
  it('records Full HD at the layout size', () => {
    expect(renderSize(OUTPUT_FORMATS.landscape, RESOLUTIONS.full)).toEqual({ width: 1920, height: 1080 });
    expect(renderSize(OUTPUT_FORMATS.portrait, RESOLUTIONS.full)).toEqual({ width: 1080, height: 1920 });
  });

  it('actually doubles for 4K rather than only raising the bitrate', () => {
    // The previous build always rendered 1920x1080 and called it 4K.
    expect(renderSize(OUTPUT_FORMATS.landscape, RESOLUTIONS.uhd)).toEqual({ width: 3840, height: 2160 });
  });

  it('scales portrait consistently', () => {
    expect(renderSize(OUTPUT_FORMATS.portrait, RESOLUTIONS.uhd)).toEqual({ width: 2160, height: 3840 });
  });

  it('always produces even dimensions, which encoders require', () => {
    Object.values(OUTPUT_FORMATS).forEach(format => {
      Object.values(RESOLUTIONS).forEach(resolution => {
        const size = renderSize(format, resolution);
        expect(size.width % 2).toBe(0);
        expect(size.height % 2).toBe(0);
      });
    });
  });

  it('preserves the aspect ratio at every resolution', () => {
    Object.values(RESOLUTIONS).forEach(resolution => {
      const size = renderSize(OUTPUT_FORMATS.landscape, resolution);
      expect(size.width / size.height).toBeCloseTo(16 / 9, 1);
    });
  });

  it('falls back to Full HD for an unknown resolution', () => {
    expect(getResolution('nope').id).toBe('full');
  });
});

describe('bitrate', () => {
  it('rises with picture size', () => {
    const small = bitrateFor({ width: 1280, height: 720 }, 30, 'balanced');
    const large = bitrateFor({ width: 3840, height: 2160 }, 30, 'balanced');
    expect(large).toBeGreaterThan(small);
  });

  it('rises with frame rate', () => {
    const thirty = bitrateFor({ width: 1920, height: 1080 }, 30, 'balanced');
    const sixty = bitrateFor({ width: 1920, height: 1080 }, 60, 'balanced');
    expect(sixty).toBeGreaterThan(thirty);
  });

  it('rises with the quality level', () => {
    const size = { width: 1920, height: 1080 };
    const levels = (['efficient', 'balanced', 'high', 'master'] as const)
      .map(level => bitrateFor(size, 30, level));
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
  });

  it('gives 1080p30 balanced a sensible everyday bitrate', () => {
    const rate = bitrateFor({ width: 1920, height: 1080 }, 30, 'balanced');
    expect(rate).toBeGreaterThan(5_000_000);
    expect(rate).toBeLessThan(12_000_000);
  });

  it('stays inside what encoders cope with', () => {
    const huge = bitrateFor({ width: 7680, height: 4320 }, 60, 'master');
    expect(huge).toBeLessThanOrEqual(120_000_000);
    const tiny = bitrateFor({ width: 16, height: 16 }, 24, 'efficient');
    expect(tiny).toBeGreaterThanOrEqual(1_500_000);
  });

  it('has a bits-per-pixel figure for every level', () => {
    Object.values(QUALITY_LEVELS).forEach(level => {
      expect(level.bitsPerPixel).toBeGreaterThan(0);
      expect(level.label).toBeTruthy();
    });
  });
});
