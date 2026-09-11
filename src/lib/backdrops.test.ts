import { describe, expect, it, vi } from 'vitest';
import { BACKDROPS, DEFAULT_BACKDROP, findBackdrop, paintBackdrop } from './backdrops';

describe('backdrop presets', () => {
  it('offers the original set plus extras', () => {
    const ids = BACKDROPS.map(b => b.id);
    for (const id of ['studio', 'blue', 'wood', 'room', 'violet', 'mountain']) {
      expect(ids).toContain(id);
    }
  });

  it('gives every preset a unique id, a name and both renderings', () => {
    const ids = new Set(BACKDROPS.map(b => b.id));
    expect(ids.size).toBe(BACKDROPS.length);
    BACKDROPS.forEach(backdrop => {
      expect(backdrop.name).toBeTruthy();
      expect(backdrop.css).toMatch(/gradient/);
      expect(backdrop.canvas.stops.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('keeps every canvas stop within 0..1 and in order', () => {
    BACKDROPS.forEach(backdrop => {
      const offsets = backdrop.canvas.stops.map(s => s.offset);
      offsets.forEach(offset => {
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThanOrEqual(1);
      });
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    });
  });

  it('uses valid colours everywhere', () => {
    BACKDROPS.forEach(backdrop => {
      backdrop.canvas.stops.forEach(stop => expect(stop.color).toMatch(/^#[0-9a-f]{6}$/i));
    });
  });

  it('falls back to the first preset for an unknown id', () => {
    expect(findBackdrop('nonsense').id).toBe(BACKDROPS[0].id);
    expect(findBackdrop(undefined).id).toBe(BACKDROPS[0].id);
    expect(findBackdrop('blue').id).toBe('blue');
  });

  it('has a default that exists', () => {
    expect(BACKDROPS.some(b => b.id === DEFAULT_BACKDROP)).toBe(true);
  });
});

describe('paintBackdrop', () => {
  /** Minimal 2D context stand-in that records what was asked of it. */
  const makeCtx = () => {
    const stops: Array<[number, string]> = [];
    const gradient = { addColorStop: (offset: number, color: string) => { stops.push([offset, color]); } };
    const calls: Record<string, unknown[]> = { linear: [], radial: [], fillRect: [] };
    const ctx = {
      createLinearGradient: (...args: number[]) => { calls.linear.push(args); return gradient; },
      createRadialGradient: (...args: number[]) => { calls.radial.push(args); return gradient; },
      fillRect: (...args: number[]) => { calls.fillRect.push(args); },
      fillStyle: null as unknown,
    } as unknown as CanvasRenderingContext2D;
    return { ctx, stops, calls };
  };

  it('fills the whole box for a linear preset', () => {
    const { ctx, calls, stops } = makeCtx();
    paintBackdrop(ctx, findBackdrop('blue'), 1920, 1080);
    expect(calls.fillRect[0]).toEqual([0, 0, 1920, 1080]);
    expect(calls.linear).toHaveLength(1);
    expect(stops.length).toBeGreaterThanOrEqual(2);
  });

  it('uses a radial gradient for a radial preset', () => {
    const { ctx, calls } = makeCtx();
    paintBackdrop(ctx, findBackdrop('studio'), 1920, 1080);
    expect(calls.radial).toHaveLength(1);
    expect(calls.linear).toHaveLength(0);
  });

  it('scales gradient geometry to the box it is given', () => {
    const { ctx, calls } = makeCtx();
    paintBackdrop(ctx, findBackdrop('wood'), 800, 400);
    // Wood runs left to right across the middle.
    expect(calls.linear[0]).toEqual([0, 200, 800, 200]);
  });

  it('never produces a zero-radius gradient', () => {
    const { ctx, calls } = makeCtx();
    paintBackdrop(ctx, findBackdrop('studio'), 1, 1);
    const args = calls.radial[0] as number[];
    expect(args[5]).toBeGreaterThan(0);
  });

  it('paints every preset without throwing', () => {
    BACKDROPS.forEach(backdrop => {
      const { ctx } = makeCtx();
      expect(() => paintBackdrop(ctx, backdrop, 1920, 1080)).not.toThrow();
    });
  });
});
