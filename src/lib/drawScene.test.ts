import { describe, expect, it } from 'vitest';
import { fitRect, wrapText } from './drawScene';

describe('fitRect', () => {
  it('stretch fills the box and uses the whole source', () => {
    const r = fitRect(100, 100, 400, 200, 'stretch');
    expect({ dx: r.dx, dy: r.dy, dw: r.dw, dh: r.dh }).toEqual({ dx: 0, dy: 0, dw: 400, dh: 200 });
    expect({ sw: r.sw, sh: r.sh }).toEqual({ sw: 100, sh: 100 });
  });

  it('cover always fills the destination box', () => {
    for (const [sw, sh] of [[1920, 1080], [640, 480], [1080, 1920]]) {
      const r = fitRect(sw, sh, 800, 450, 'cover');
      expect(r.dw).toBe(800);
      expect(r.dh).toBe(450);
    }
  });

  it('cover crops the wider axis and stays centred', () => {
    // A 16:9 camera into a 1:1 box crops the sides.
    const r = fitRect(1600, 900, 500, 500, 'cover');
    expect(r.sh).toBe(900);
    expect(r.sw).toBeCloseTo(900, 5);
    expect(r.sx).toBeCloseTo((1600 - 900) / 2, 5);
  });

  it('cover crops the taller axis for a portrait source', () => {
    const r = fitRect(900, 1600, 500, 500, 'cover');
    expect(r.sw).toBe(900);
    expect(r.sh).toBeCloseTo(900, 5);
    expect(r.sy).toBeCloseTo((1600 - 900) / 2, 5);
  });

  it('contain never crops the source', () => {
    const r = fitRect(1600, 900, 500, 500, 'contain');
    expect({ sx: r.sx, sy: r.sy, sw: r.sw, sh: r.sh }).toEqual({ sx: 0, sy: 0, sw: 1600, sh: 900 });
  });

  it('contain letterboxes a wide source inside a square box', () => {
    const r = fitRect(1600, 900, 500, 500, 'contain');
    expect(r.dw).toBe(500);
    expect(r.dh).toBeCloseTo(500 * (900 / 1600), 5);
    expect(r.dy).toBeGreaterThan(0);
    expect(r.dx).toBe(0);
  });

  it('contain pillarboxes a tall source inside a wide box', () => {
    const r = fitRect(900, 1600, 800, 450, 'contain');
    expect(r.dh).toBe(450);
    expect(r.dx).toBeGreaterThan(0);
  });

  it('keeps the source aspect ratio when containing', () => {
    const r = fitRect(1600, 900, 500, 500, 'contain');
    expect(r.dw / r.dh).toBeCloseTo(1600 / 900, 4);
  });

  it('survives a source with no dimensions yet', () => {
    const r = fitRect(0, 0, 400, 300, 'cover');
    expect(r.dw).toBe(400);
    expect(r.dh).toBe(300);
    expect(Number.isFinite(r.sw)).toBe(true);
    expect(r.sw).toBeGreaterThan(0);
  });

  it('matches the box exactly when ratios agree', () => {
    const r = fitRect(1920, 1080, 960, 540, 'cover');
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
    expect(r.sw).toBe(1920);
    expect(r.sh).toBeCloseTo(1080, 5);
  });
});

describe('wrapText', () => {
  // A stand-in for CanvasRenderingContext2D where each character is 10 units wide.
  const ctx = { measureText: (text: string) => ({ width: text.length * 10 }) } as unknown as CanvasRenderingContext2D;

  it('keeps a short line intact', () => {
    expect(wrapText(ctx, 'Hello world', 1000)).toEqual(['Hello world']);
  });

  it('breaks on width', () => {
    // 100 units fits 10 characters.
    expect(wrapText(ctx, 'aaaa bbbb cccc', 100)).toEqual(['aaaa bbbb', 'cccc']);
  });

  it('honours explicit newlines', () => {
    expect(wrapText(ctx, 'one\ntwo', 1000)).toEqual(['one', 'two']);
  });

  it('preserves a blank line between paragraphs', () => {
    expect(wrapText(ctx, 'a\n\nb', 1000)).toEqual(['a', '', 'b']);
  });

  it('returns a single empty line for empty input', () => {
    expect(wrapText(ctx, '', 1000)).toEqual(['']);
  });

  it('does not drop a word longer than the line', () => {
    const result = wrapText(ctx, 'superlongword next', 50);
    expect(result.join(' ')).toContain('superlongword');
  });

  it('collapses runs of whitespace', () => {
    expect(wrapText(ctx, 'a    b', 1000)).toEqual(['a b']);
  });
});
