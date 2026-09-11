import { describe, expect, it } from 'vitest';
import {
  CANVAS_HEIGHT, CANVAS_WIDTH, MIN_SIZE, clampToCanvas, centreRect, createScene,
  createSource, fitToCanvas, hitTest, normalizeScenes, reorder, resizeRect, snapRect,
  type Rect, type Source,
} from './scene';

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe('source creation', () => {
  it('gives every source a unique id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createSource('text').id));
    expect(ids.size).toBe(50);
  });

  it('defaults the keyboard to the full 88-key compass', () => {
    const keyboard = createSource('keyboard');
    expect(keyboard.props.firstNote).toBe(21); // A0
    expect(keyboard.props.lastNote).toBe(108); // C8
  });

  it('merges overridden props without dropping the defaults', () => {
    const camera = createSource('camera', { props: { deviceId: 'cam-1' } });
    expect(camera.props.deviceId).toBe('cam-1');
    expect(camera.props.fit).toBe('cover');
  });

  it('accepts positional overrides', () => {
    const source = createSource('text', { x: 100, y: 200, width: 300, height: 50 });
    expect(source).toMatchObject({ x: 100, y: 200, width: 300, height: 50 });
  });
});

describe('new scenes', () => {
  it('starts empty so the teacher builds their own layout', () => {
    expect(createScene('My lesson').sources).toEqual([]);
  });
});

describe('clampToCanvas', () => {
  it('keeps a rect inside the canvas without resizing it', () => {
    expect(clampToCanvas(rect(-50, -50, 400, 300))).toEqual(rect(0, 0, 400, 300));
    expect(clampToCanvas(rect(1900, 1050, 400, 300))).toEqual(rect(1520, 780, 400, 300));
  });

  it('shrinks a rect larger than the canvas', () => {
    const result = clampToCanvas(rect(0, 0, 4000, 4000));
    expect(result.width).toBe(CANVAS_WIDTH);
    expect(result.height).toBe(CANVAS_HEIGHT);
  });

  it('leaves a rect that already fits alone', () => {
    expect(clampToCanvas(rect(100, 100, 200, 200))).toEqual(rect(100, 100, 200, 200));
  });
});

describe('resizeRect', () => {
  const start = rect(100, 100, 400, 200);

  it('grows from the south-east handle', () => {
    expect(resizeRect(start, 'se', 100, 50)).toEqual(rect(100, 100, 500, 250));
  });

  it('moves the origin when dragging the north-west handle', () => {
    expect(resizeRect(start, 'nw', 50, 50)).toEqual(rect(150, 150, 350, 150));
  });

  it('only changes one axis for an edge handle', () => {
    expect(resizeRect(start, 'e', 100, 999)).toEqual(rect(100, 100, 500, 200));
    expect(resizeRect(start, 's', 999, 100)).toEqual(rect(100, 100, 400, 300));
  });

  it('refuses to shrink below the minimum size', () => {
    const result = resizeRect(start, 'se', -10_000, -10_000);
    expect(result.width).toBe(MIN_SIZE);
    expect(result.height).toBe(MIN_SIZE);
  });

  it('keeps the far edge pinned when shrinking from the west', () => {
    const result = resizeRect(start, 'w', 10_000, 0);
    expect(result.x + result.width).toBe(start.x + start.width);
  });

  it('preserves the aspect ratio when asked', () => {
    const square = rect(0, 0, 200, 200);
    const result = resizeRect(square, 'se', 100, 0, true);
    expect(result.width).toBe(result.height);
  });

  it('keeps a 16:9 source at 16:9 through an aspect-locked drag', () => {
    const wide = rect(0, 0, 1600, 900);
    const result = resizeRect(wide, 'se', -400, 0, true);
    expect(result.width / result.height).toBeCloseTo(16 / 9, 2);
  });
});

describe('snapRect', () => {
  it('snaps a near-miss to the canvas left edge', () => {
    const { rect: snapped, guides } = snapRect(rect(6, 300, 400, 200), []);
    expect(snapped.x).toBe(0);
    expect(guides).toContainEqual({ axis: 'x', position: 0 });
  });

  it('snaps to the canvas centre', () => {
    // Centred horizontally would put x at 760.
    const { rect: snapped } = snapRect(rect(755, 300, 400, 200), []);
    expect(snapped.x + snapped.width / 2).toBe(CANVAS_WIDTH / 2);
  });

  it('aligns with another source’s edge', () => {
    const other = rect(500, 0, 200, 200);
    const { rect: snapped } = snapRect(rect(496, 400, 300, 100), [other]);
    expect(snapped.x).toBe(500);
  });

  it('leaves a rect alone when nothing is close', () => {
    const input = rect(613, 377, 291, 133);
    expect(snapRect(input, []).rect).toEqual(input);
  });

  it('never changes the size, only the position', () => {
    const input = rect(4, 4, 321, 123);
    const { rect: snapped } = snapRect(input, []);
    expect(snapped.width).toBe(input.width);
    expect(snapped.height).toBe(input.height);
  });
});

describe('hitTest', () => {
  const build = (over: Partial<Source>): Source => createSource('color', over);
  const bottom = build({ x: 0, y: 0, width: 500, height: 500 });
  const top = build({ x: 100, y: 100, width: 200, height: 200 });

  it('returns the topmost source under the point', () => {
    expect(hitTest([bottom, top], 150, 150)?.id).toBe(top.id);
  });

  it('falls through to a lower source outside the top one', () => {
    expect(hitTest([bottom, top], 450, 450)?.id).toBe(bottom.id);
  });

  it('ignores hidden and locked sources', () => {
    const hidden = build({ x: 0, y: 0, width: 500, height: 500, visible: false });
    const locked = build({ x: 0, y: 0, width: 500, height: 500, locked: true });
    expect(hitTest([hidden], 100, 100)).toBeNull();
    expect(hitTest([locked], 100, 100)).toBeNull();
  });

  it('returns null on empty canvas', () => {
    expect(hitTest([], 10, 10)).toBeNull();
  });
});

describe('reorder', () => {
  const make = (name: string) => createSource('text', { name });
  const a = make('a'); const b = make('b'); const c = make('c');
  const list = [a, b, c];

  it('raises and lowers by one place', () => {
    expect(reorder(list, a.id, 'up').map(s => s.name)).toEqual(['b', 'a', 'c']);
    expect(reorder(list, c.id, 'down').map(s => s.name)).toEqual(['a', 'c', 'b']);
  });

  it('jumps to front and back', () => {
    expect(reorder(list, a.id, 'top').map(s => s.name)).toEqual(['b', 'c', 'a']);
    expect(reorder(list, c.id, 'bottom').map(s => s.name)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op at the ends', () => {
    expect(reorder(list, c.id, 'up').map(s => s.name)).toEqual(['a', 'b', 'c']);
    expect(reorder(list, a.id, 'down').map(s => s.name)).toEqual(['a', 'b', 'c']);
  });

  it('ignores an unknown id', () => {
    expect(reorder(list, 'nope', 'up')).toBe(list);
  });
});

describe('fitting helpers', () => {
  it('centres without resizing', () => {
    const result = centreRect(rect(0, 0, 800, 600));
    expect(result.x).toBe((CANVAS_WIDTH - 800) / 2);
    expect(result.y).toBe((CANVAS_HEIGHT - 600) / 2);
  });

  it('fits a 16:9 source to the whole canvas', () => {
    expect(fitToCanvas(16 / 9)).toEqual(rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT));
  });

  it('letterboxes a 4:3 source inside the canvas', () => {
    const result = fitToCanvas(4 / 3);
    expect(result.height).toBe(CANVAS_HEIGHT);
    expect(result.width).toBe(1440);
    expect(result.x).toBe(240);
  });
});

describe('normalizeScenes', () => {
  it('returns an empty list for junk', () => {
    expect(normalizeScenes(null)).toEqual([]);
    expect(normalizeScenes('nope')).toEqual([]);
    expect(normalizeScenes({})).toEqual([]);
  });

  it('round-trips a real scene', () => {
    const scene = createScene('Lesson');
    scene.sources.push(createSource('keyboard'), createSource('camera'));
    const [restored] = normalizeScenes(JSON.parse(JSON.stringify([scene])));
    expect(restored.name).toBe('Lesson');
    expect(restored.sources.map(s => s.kind)).toEqual(['keyboard', 'camera']);
    expect(restored.sources[0].props.firstNote).toBe(21);
  });

  it('drops sources with a bad kind or missing geometry', () => {
    const [restored] = normalizeScenes([{
      name: 'Mixed',
      sources: [
        { kind: 'camera', x: 0, y: 0, width: 100, height: 100 },
        { kind: 'wormhole', x: 0, y: 0, width: 100, height: 100 },
        { kind: 'text', x: 'left', y: 0, width: 100, height: 100 },
        { kind: 'text', x: 0, y: 0 },
      ],
    }]);
    expect(restored.sources).toHaveLength(1);
    expect(restored.sources[0].kind).toBe('camera');
  });

  it('preserves layer order', () => {
    const scene = createScene('Ordered');
    scene.sources.push(
      createSource('color', { name: 'back' }),
      createSource('text', { name: 'front' }),
    );
    const [restored] = normalizeScenes([scene]);
    expect(restored.sources.map(s => s.name)).toEqual(['back', 'front']);
  });

  it('clamps opacity and enforces a minimum size', () => {
    const [restored] = normalizeScenes([{
      name: 'Odd',
      sources: [{ kind: 'text', x: 0, y: 0, width: 1, height: 1, opacity: 7 }],
    }]);
    expect(restored.sources[0].opacity).toBe(1);
    expect(restored.sources[0].width).toBe(MIN_SIZE);
  });
});
