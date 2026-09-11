/**
 * Scene model.
 *
 * A scene is an ordered list of sources laid out on a fixed 1920x1080 canvas,
 * the way OBS works. Positions are stored in canvas coordinates rather than
 * screen pixels, so a scene looks identical whatever size the preview is drawn
 * at and records at full resolution regardless of the window.
 *
 * Source order is bottom-to-top: sources[0] paints first, the last entry sits
 * on top.
 */

export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

export type SourceKind = 'camera' | 'keyboard' | 'text' | 'image' | 'color' | 'chord';

export type Rect = { x: number; y: number; width: number; height: number };

export type SourceProps = {
  /** camera: which capture device to show. */
  deviceId?: string;
  /** camera/image: how the picture fills its box. */
  fit?: 'cover' | 'contain' | 'stretch';
  /** camera: mirror horizontally, which most teachers want for a face shot. */
  mirror?: boolean;
  /** text: the words, plus their styling. */
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  align?: 'left' | 'center' | 'right';
  color?: string;
  lineHeight?: number;
  /** color/text: background fill. */
  background?: string;
  /** image: source URL. */
  src?: string;
  /** keyboard: range and appearance. */
  firstNote?: number;
  lastNote?: number;
  accent?: string;
  showLabels?: 'none' | 'c-only' | 'all';
  /** chord: what to include in the readout. */
  showRoman?: boolean;
  /** shared: corner rounding in canvas pixels. */
  radius?: number;
};

export type Source = {
  id: string;
  kind: SourceKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  props: SourceProps;
};

export type Scene = {
  id: string;
  name: string;
  sources: Source[];
};

let idCounter = 0;
/** Short unique id. Time-based so ids stay unique across reloads. */
export const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/* ------------------------------------------------------------------ *
 * Source factories
 * ------------------------------------------------------------------ */

const BASE: Omit<Source, 'id' | 'kind' | 'name' | 'props'> = {
  x: 0, y: 0, width: 960, height: 540, visible: true, locked: false, opacity: 1,
};

export function createSource(kind: SourceKind, overrides: Partial<Source> = {}): Source {
  const defaults: Record<SourceKind, { name: string; rect: Rect; props: SourceProps }> = {
    camera: {
      name: 'Camera',
      rect: { x: 1060, y: 60, width: 800, height: 450 },
      props: { fit: 'cover', mirror: false, radius: 18 },
    },
    keyboard: {
      name: 'Virtual keyboard',
      // A full 88-key board is very wide; default to a full-width strip.
      rect: { x: 60, y: 760, width: 1800, height: 260 },
      props: { firstNote: 21, lastNote: 108, accent: '#1d9cff', showLabels: 'c-only', radius: 12 },
    },
    text: {
      name: 'Text',
      rect: { x: 80, y: 120, width: 760, height: 200 },
      props: {
        text: 'Lesson title', fontSize: 72, fontWeight: 700, align: 'left',
        color: '#ffffff', lineHeight: 1.15, background: 'transparent',
      },
    },
    image: {
      name: 'Image',
      rect: { x: 80, y: 80, width: 600, height: 400 },
      props: { fit: 'contain', radius: 12 },
    },
    color: {
      name: 'Colour block',
      rect: { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      props: { background: '#0b1a2b', radius: 0 },
    },
    chord: {
      name: 'Chord readout',
      rect: { x: 80, y: 560, width: 520, height: 160 },
      props: {
        color: '#ffffff', fontSize: 84, background: 'rgba(6,16,26,0.72)',
        showRoman: true, align: 'left', radius: 14,
      },
    },
  };

  const preset = defaults[kind];
  const { props: overriddenProps, ...rest } = overrides;
  return {
    ...BASE,
    ...preset.rect,
    id: createId(kind),
    kind,
    name: preset.name,
    ...rest,
    // Overridden props are merged over the preset rather than replacing it.
    props: { ...preset.props, ...(overriddenProps ?? {}) },
  };
}

/** A new scene starts empty — the teacher builds their own layout. */
export function createScene(name: string): Scene {
  return { id: createId('scene'), name, sources: [] };
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const MIN_SIZE = 40;

const round = (value: number) => Math.round(value);

/** Keep a rect inside the canvas without changing its size. */
export function clampToCanvas(rect: Rect): Rect {
  const width = Math.min(rect.width, CANVAS_WIDTH);
  const height = Math.min(rect.height, CANVAS_HEIGHT);
  return {
    width,
    height,
    x: Math.max(0, Math.min(CANVAS_WIDTH - width, rect.x)),
    y: Math.max(0, Math.min(CANVAS_HEIGHT - height, rect.y)),
  };
}

/**
 * Resize from a handle. `aspect` locks the original width/height ratio, which
 * is what holding Shift does while dragging a corner.
 */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, aspect = false): Rect {
  let { x, y, width, height } = start;

  if (handle.includes('w')) {
    const nextWidth = Math.max(MIN_SIZE, start.width - dx);
    x = start.x + (start.width - nextWidth);
    width = nextWidth;
  }
  if (handle.includes('e')) width = Math.max(MIN_SIZE, start.width + dx);
  if (handle.includes('n')) {
    const nextHeight = Math.max(MIN_SIZE, start.height - dy);
    y = start.y + (start.height - nextHeight);
    height = nextHeight;
  }
  if (handle.includes('s')) height = Math.max(MIN_SIZE, start.height + dy);

  if (aspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    // Corner drags follow the larger change; edge drags derive the other side.
    if (handle.length === 2) {
      if (Math.abs(width - start.width) >= Math.abs(height - start.height)) height = width / ratio;
      else width = height * ratio;
    } else if (handle === 'e' || handle === 'w') {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
    height = Math.max(MIN_SIZE, height);
    width = Math.max(MIN_SIZE, width);
    if (handle.includes('w')) x = start.x + start.width - width;
    if (handle.includes('n')) y = start.y + start.height - height;
  }

  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}

export type SnapGuide = { axis: 'x' | 'y'; position: number };

/**
 * Nudge a moving rect onto nearby alignments: canvas edges, canvas centre, and
 * the edges and centres of the other sources. Returns the adjusted rect plus
 * the guides to draw.
 */
export function snapRect(
  rect: Rect,
  others: Rect[],
  threshold = 12,
): { rect: Rect; guides: SnapGuide[] } {
  const guides: SnapGuide[] = [];
  let { x, y } = rect;

  const verticalTargets = [0, CANVAS_WIDTH / 2, CANVAS_WIDTH];
  const horizontalTargets = [0, CANVAS_HEIGHT / 2, CANVAS_HEIGHT];
  others.forEach(other => {
    verticalTargets.push(other.x, other.x + other.width / 2, other.x + other.width);
    horizontalTargets.push(other.y, other.y + other.height / 2, other.y + other.height);
  });

  // Each edge of the moving rect can land on any target.
  const xEdges = [
    { offset: 0, value: rect.x },
    { offset: rect.width / 2, value: rect.x + rect.width / 2 },
    { offset: rect.width, value: rect.x + rect.width },
  ];
  const yEdges = [
    { offset: 0, value: rect.y },
    { offset: rect.height / 2, value: rect.y + rect.height / 2 },
    { offset: rect.height, value: rect.y + rect.height },
  ];

  let bestX: { distance: number; x: number; guide: number } | null = null;
  xEdges.forEach(edge => {
    verticalTargets.forEach(target => {
      const distance = Math.abs(edge.value - target);
      if (distance <= threshold && (!bestX || distance < bestX.distance)) {
        bestX = { distance, x: target - edge.offset, guide: target };
      }
    });
  });

  let bestY: { distance: number; y: number; guide: number } | null = null;
  yEdges.forEach(edge => {
    horizontalTargets.forEach(target => {
      const distance = Math.abs(edge.value - target);
      if (distance <= threshold && (!bestY || distance < bestY.distance)) {
        bestY = { distance, y: target - edge.offset, guide: target };
      }
    });
  });

  if (bestX) {
    x = (bestX as { x: number }).x;
    guides.push({ axis: 'x', position: (bestX as { guide: number }).guide });
  }
  if (bestY) {
    y = (bestY as { y: number }).y;
    guides.push({ axis: 'y', position: (bestY as { guide: number }).guide });
  }

  return { rect: { ...rect, x: round(x), y: round(y) }, guides };
}

/** Topmost visible, unlocked source containing the point. */
export function hitTest(sources: Source[], x: number, y: number): Source | null {
  for (let i = sources.length - 1; i >= 0; i--) {
    const source = sources[i];
    if (!source.visible || source.locked) continue;
    if (x >= source.x && x <= source.x + source.width && y >= source.y && y <= source.y + source.height) {
      return source;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Ordering and fitting
 * ------------------------------------------------------------------ */

export type ReorderDirection = 'up' | 'down' | 'top' | 'bottom';

export function reorder(sources: Source[], id: string, direction: ReorderDirection): Source[] {
  const index = sources.findIndex(source => source.id === id);
  if (index < 0) return sources;
  const next = [...sources];
  const [item] = next.splice(index, 1);
  const target =
    direction === 'top' ? next.length
      : direction === 'bottom' ? 0
        : direction === 'up' ? Math.min(next.length, index + 1)
          : Math.max(0, index - 1);
  next.splice(target, 0, item);
  return next;
}

/** Stretch a source to fill the whole canvas. */
export const fillCanvas = (): Rect => ({ x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT });

/** Centre a rect without resizing it. */
export function centreRect(rect: Rect): Rect {
  return {
    ...rect,
    x: round((CANVAS_WIDTH - rect.width) / 2),
    y: round((CANVAS_HEIGHT - rect.height) / 2),
  };
}

/**
 * Scale a rect to fit the canvas while keeping `ratio` (width / height),
 * then centre it — the equivalent of "Fit to screen".
 */
export function fitToCanvas(ratio: number): Rect {
  const canvasRatio = CANVAS_WIDTH / CANVAS_HEIGHT;
  const width = ratio >= canvasRatio ? CANVAS_WIDTH : round(CANVAS_HEIGHT * ratio);
  const height = ratio >= canvasRatio ? round(CANVAS_WIDTH / ratio) : CANVAS_HEIGHT;
  return centreRect({ x: 0, y: 0, width, height });
}

/* ------------------------------------------------------------------ *
 * Serialisation
 * ------------------------------------------------------------------ */

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Rebuild a scene list from stored JSON, discarding anything malformed. */
export function normalizeScenes(raw: unknown): Scene[] {
  if (!Array.isArray(raw)) return [];
  const scenes: Scene[] = [];
  raw.forEach(entry => {
    if (!entry || typeof entry !== 'object') return;
    const candidate = entry as Partial<Scene>;
    if (typeof candidate.name !== 'string') return;
    const sources: Source[] = [];
    (Array.isArray(candidate.sources) ? candidate.sources : []).forEach(item => {
      if (!item || typeof item !== 'object') return;
      const source = item as Partial<Source>;
      if (typeof source.kind !== 'string') return;
      if (!['camera', 'keyboard', 'text', 'image', 'color', 'chord'].includes(source.kind)) return;
      if (!isFiniteNumber(source.x) || !isFiniteNumber(source.y)) return;
      if (!isFiniteNumber(source.width) || !isFiniteNumber(source.height)) return;
      sources.push({
        id: typeof source.id === 'string' ? source.id : createId(source.kind),
        kind: source.kind as SourceKind,
        name: typeof source.name === 'string' ? source.name : source.kind,
        x: source.x,
        y: source.y,
        width: Math.max(MIN_SIZE, source.width),
        height: Math.max(MIN_SIZE, source.height),
        visible: source.visible !== false,
        locked: source.locked === true,
        opacity: isFiniteNumber(source.opacity) ? Math.min(1, Math.max(0, source.opacity)) : 1,
        props: (source.props && typeof source.props === 'object' ? source.props : {}) as SourceProps,
      });
    });
    scenes.push({
      id: typeof candidate.id === 'string' ? candidate.id : createId('scene'),
      name: candidate.name,
      sources,
    });
  });
  return scenes;
}
