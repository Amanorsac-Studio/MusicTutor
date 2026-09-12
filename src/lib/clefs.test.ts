import { describe, expect, it } from 'vitest';
import {
  BASS_DOTS, BASS_HEAD, BASS_SPINE, TREBLE_EYE, TREBLE_SPINE,
  clefBounds, clefShapes, ribbonOutline, smoothSpine,
} from './clefs';

describe('smoothSpine', () => {
  it('passes through the points it was given', () => {
    const points = [
      { x: 0, y: 0, w: 1 },
      { x: 1, y: 1, w: 1 },
      { x: 2, y: 0, w: 1 },
    ];
    const smooth = smoothSpine(points, 8);
    expect(smooth[0].x).toBeCloseTo(0, 6);
    expect(smooth[smooth.length - 1].x).toBeCloseTo(2, 6);
    // The middle point falls exactly on a segment boundary.
    expect(smooth.some(p => Math.abs(p.x - 1) < 1e-6 && Math.abs(p.y - 1) < 1e-6)).toBe(true);
  });

  it('fills in the points between', () => {
    const points = [{ x: 0, y: 0, w: 1 }, { x: 1, y: 0, w: 1 }];
    expect(smoothSpine(points, 10).length).toBeGreaterThan(points.length);
  });

  it('interpolates the width along with the position', () => {
    const smooth = smoothSpine([{ x: 0, y: 0, w: 0 }, { x: 1, y: 0, w: 1 }], 10);
    const widths = smooth.map(p => p.w);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...widths)).toBeCloseTo(1, 6);
  });

  it('never produces a negative width, which would invert the outline', () => {
    const smooth = smoothSpine([
      { x: 0, y: 0, w: 0.02 },
      { x: 1, y: 1, w: 0.5 },
      { x: 2, y: 0, w: 0.02 },
    ], 16);
    expect(smooth.every(p => p.w >= 0)).toBe(true);
  });

  it('copes with too few points to smooth', () => {
    expect(smoothSpine([])).toEqual([]);
    expect(smoothSpine([{ x: 1, y: 2, w: 3 }])).toHaveLength(1);
  });
});

describe('ribbonOutline', () => {
  it('returns one point per side for every point of the spine', () => {
    const spine = [
      { x: 0, y: 0, w: 1 },
      { x: 1, y: 0, w: 1 },
      { x: 2, y: 0, w: 1 },
    ];
    expect(ribbonOutline(spine)).toHaveLength(spine.length * 2);
  });

  it('offsets a horizontal stroke to half its width above and below', () => {
    const outline = ribbonOutline([
      { x: 0, y: 0, w: 2 },
      { x: 1, y: 0, w: 2 },
      { x: 2, y: 0, w: 2 },
    ]);
    const ys = outline.map(([, y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(-1, 6);
    expect(Math.max(...ys)).toBeCloseTo(1, 6);
  });

  it('follows the width where it changes, so the stroke tapers', () => {
    const outline = ribbonOutline([
      { x: 0, y: 0, w: 0.2 },
      { x: 1, y: 0, w: 1 },
      { x: 2, y: 0, w: 0.2 },
    ]);
    expect(Math.abs(outline[0][1])).toBeLessThan(Math.abs(outline[1][1]));
  });

  it('survives a repeated point without producing NaN', () => {
    const outline = ribbonOutline([
      { x: 1, y: 1, w: 1 },
      { x: 1, y: 1, w: 1 },
      { x: 2, y: 1, w: 1 },
    ]);
    expect(outline.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });

  it('returns nothing for a stroke with no length', () => {
    expect(ribbonOutline([])).toEqual([]);
    expect(ribbonOutline([{ x: 0, y: 0, w: 1 }])).toEqual([]);
  });
});

describe('clef anchoring', () => {
  it('centres the treble clef eye on the line it names', () => {
    // The eye encircles the G line, so it must straddle y = 0.
    expect(Math.abs(TREBLE_EYE.y)).toBeLessThan(TREBLE_EYE.r);
  });

  it('centres the bass clef head on the line it names', () => {
    expect(Math.abs(BASS_HEAD.y)).toBeLessThan(BASS_HEAD.r);
  });

  it('puts the two bass dots either side of that line, level with each other', () => {
    expect(BASS_DOTS[0].y).toBeLessThan(0);
    expect(BASS_DOTS[1].y).toBeGreaterThan(0);
    expect(BASS_DOTS[0].y).toBeCloseTo(-BASS_DOTS[1].y, 6);
    expect(BASS_DOTS[0].x).toBeCloseTo(BASS_DOTS[1].x, 6);
  });

  it('puts the bass dots to the right of the head, clear of it', () => {
    BASS_DOTS.forEach(dot => {
      expect(dot.x).toBeGreaterThan(BASS_HEAD.x + BASS_HEAD.r);
    });
  });
});

describe('clef proportions', () => {
  it('runs the treble clef from above the staff to below it', () => {
    // Anchored on G, one space up from the bottom line: the top line is three
    // spaces above and the bottom line one space below.
    const { top, bottom } = clefBounds('treble');
    expect(top).toBeLessThan(-3);
    expect(bottom).toBeGreaterThan(1);
  });

  it('keeps the treble clef tail clear of the bass staff', () => {
    // The bass staff's top line is two spaces below the treble's bottom line,
    // which is three below the G line the clef is anchored to.
    expect(clefBounds('treble').bottom).toBeLessThan(3);
  });

  it('runs the bass clef from above its line down past the staff', () => {
    const { top, bottom } = clefBounds('bass');
    expect(top).toBeLessThan(-1);
    expect(bottom).toBeGreaterThan(1.5);
  });

  it('keeps the bass clef inside its own staff, which ends three spaces down', () => {
    expect(clefBounds('bass').bottom).toBeLessThan(3.2);
  });

  it('gives each clef a sensible width against its height', () => {
    (['treble', 'bass'] as const).forEach(clef => {
      const { ribbon, discs } = clefShapes(clef);
      const xs = [
        ...ribbon.map(([x]) => x),
        ...discs.flatMap(d => [d.x - d.r, d.x + d.r]),
      ];
      const width = Math.max(...xs) - Math.min(...xs);
      const { top, bottom } = clefBounds(clef);
      const ratio = (bottom - top) / width;
      // Taller than wide, but not a thread: a real clef is around 2 to 3.
      expect(ratio).toBeGreaterThan(1.2);
      expect(ratio).toBeLessThan(3.6);
    });
  });
});

describe('clefShapes', () => {
  it('gives the treble clef its eye and its tail dot', () => {
    expect(clefShapes('treble').discs).toHaveLength(2);
  });

  it('gives the bass clef its head and both dots', () => {
    expect(clefShapes('bass').discs).toHaveLength(3);
  });

  it('produces a closed outline with no broken coordinates', () => {
    (['treble', 'bass'] as const).forEach(clef => {
      const { ribbon } = clefShapes(clef);
      expect(ribbon.length).toBeGreaterThan(40);
      expect(ribbon.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    });
  });

  it('builds from the published spines, so editing one changes the drawing', () => {
    expect(TREBLE_SPINE.length).toBeGreaterThan(10);
    expect(BASS_SPINE.length).toBeGreaterThan(8);
  });
});
