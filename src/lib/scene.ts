/**
 * Scene model.
 *
 * A scene holds one layout per output format, the way OBS holds a canvas.
 * Landscape and portrait are genuinely different arrangements — a 16:9 lesson
 * shot does not become a good TikTok by squashing it — so each format keeps its
 * own source list and they can be streamed at the same time.
 *
 * Positions are stored in the format's layout space (1920x1080 for landscape,
 * 1080x1920 for portrait), never in screen pixels, so a scene looks identical
 * whatever size the preview is and records correctly at any resolution.
 *
 * Within a layout, order is bottom-to-top: sources[0] paints first.
 */

import { DEFAULT_FORMAT, getFormat, type CanvasSize, type OutputFormatId } from './formats';

/** Landscape layout space. Kept for defaults and for tests. */
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

export const LANDSCAPE_CANVAS: CanvasSize = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };

export type SourceKind = 'camera' | 'keyboard' | 'staff' | 'fretboard' | 'notes' | 'text' | 'image' | 'color' | 'chord' | 'backdrop';

/**
 * Cameras are assigned a teaching role rather than a bare device. A face
 * camera is the usual 16:9 head-and-shoulders shot; a hand camera is the wide
 * overhead strip looking down at the keys.
 */
export type CameraRole = 'face' | 'hand' | 'other';

/** How a chord readout is written. */
export type ChordDisplayMode = 'names' | 'numerals' | 'both';

export type Rect = { x: number; y: number; width: number; height: number };

export type SourceProps = {
  /** camera: which capture device to show. */
  deviceId?: string;
  /** camera: what this shot is for; drives its default shape. */
  role?: CameraRole;
  /** backdrop: which preset to paint. */
  backdrop?: string;
  /** camera/image: how the picture fills its box. */
  fit?: 'cover' | 'contain' | 'stretch';
  /** camera: mirror horizontally, which most teachers want for a face shot. */
  mirror?: boolean;
  /**
   * camera/image: push in on the picture. 1 shows the whole frame; 2 shows the
   * middle half. Pan moves the visible window, as a fraction of the overflow,
   * from -1 (hard left/top) through 0 (centred) to 1.
   */
  zoom?: number;
  panX?: number;
  panY?: number;
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
  /** Name each sounding note above the key, as in a lesson video. */
  namePlayed?: boolean;
  /** chord: what to show and how prominently. */
  chordMode?: ChordDisplayMode;
  /** chord: relative size of the Roman numeral against the chord name, 0.2..3. */
  numeralScale?: number;
  showQuality?: boolean;
  /** notes: say the notes as letter names, solfa or scale numbers. */
  noteMode?: 'names' | 'solfa' | 'numbers';
  /** shared: corner rounding in layout pixels. */
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

export type SceneLayouts = Partial<Record<OutputFormatId, Source[]>>;

export type Scene = {
  id: string;
  name: string;
  layouts: SceneLayouts;
};

let idCounter = 0;
/** Short unique id. Time-based so ids stay unique across reloads. */
export const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/** The source list for a format, or an empty list if that format is unused. */
export const layoutFor = (scene: Scene | undefined, format: OutputFormatId): Source[] =>
  scene?.layouts[format] ?? [];

/** Replace one format's layout, leaving the others untouched. */
export const withLayout = (scene: Scene, format: OutputFormatId, sources: Source[]): Scene =>
  ({ ...scene, layouts: { ...scene.layouts, [format]: sources } });

/** Total sources across every format, for summarising a scene. */
export const countSources = (scene: Scene): number =>
  Object.values(scene.layouts).reduce((total, list) => total + (list?.length ?? 0), 0);

/* ------------------------------------------------------------------ *
 * Source factories
 * ------------------------------------------------------------------ */

const BASE: Omit<Source, 'id' | 'kind' | 'name' | 'props'> = {
  x: 0, y: 0, width: 960, height: 540, visible: true, locked: false, opacity: 1,
};

/** Default frame and styling for each kind, sized to the canvas it lands on. */
function sourceDefaults(kind: SourceKind, canvas: CanvasSize): { name: string; rect: Rect; props: SourceProps } {
  const { width: cw, height: ch } = canvas;
  const margin = Math.round(Math.min(cw, ch) * 0.035);

  switch (kind) {
    case 'camera':
      return {
        name: 'Face camera',
        rect: {
          x: Math.round(cw * 0.55), y: margin,
          width: Math.round(cw * 0.42), height: Math.round(cw * 0.42 * 9 / 16),
        },
        props: { fit: 'cover', mirror: false, radius: 18, role: 'face', zoom: 1, panX: 0, panY: 0 },
      };
    case 'backdrop':
      return { name: 'Backdrop', rect: { x: 0, y: 0, width: cw, height: ch }, props: { backdrop: 'studio', radius: 0 } };
    case 'keyboard': {
      const width = cw - margin * 2;
      // Proportioned rather than a fixed fraction of the canvas, so a portrait
      // layout gets a keyboard that looks like an instrument instead of a
      // stretched band of slivers.
      const height = Math.min(Math.round(ch * 0.4), naturalKeyboardHeight(width));
      return {
        name: 'Virtual keyboard',
        rect: { x: margin, y: ch - margin - height, width, height },
        props: { firstNote: 21, lastNote: 108, accent: '#ffa629', showLabels: 'c-only', namePlayed: true, radius: 12 },
      };
    }
    case 'staff': {
      // A grand staff needs room for both staves plus ledger lines, so it is
      // sized by height first and given a readable width from that.
      const height = Math.round(Math.min(ch * 0.34, cw * 0.3));
      return {
        name: 'Notation staff',
        rect: {
          x: margin, y: Math.round(ch * 0.1),
          width: Math.round(Math.min(cw - margin * 2, height * 1.9)), height,
        },
        props: {
          accent: '#ffa629', color: '#0d1420', background: 'rgba(255,255,255,0.94)',
          namePlayed: true, radius: 14,
        },
      };
    }
    case 'notes':
      return {
        name: 'Note display',
        rect: {
          x: margin, y: Math.round(ch * 0.3),
          width: Math.round(cw * 0.46), height: Math.round(ch * 0.22),
        },
        props: {
          noteMode: 'names', color: '#ffffff', accent: '#ffa629',
          background: 'rgba(6,16,26,0.72)', align: 'center', radius: 16,
        },
      };
    case 'fretboard': {
      // A neck is long and low, so it is sized from the canvas width and sits
      // along the bottom, where the keyboard would otherwise go.
      const width = cw - margin * 2;
      const height = Math.round(Math.min(ch * 0.3, width * 0.24));
      return {
        name: 'Bass fretboard',
        rect: { x: margin, y: ch - margin - height, width, height },
        props: { accent: '#ffa629', background: 'rgba(6,16,26,0.78)', namePlayed: true, radius: 14 },
      };
    }
    case 'text':
      return {
        name: 'Text',
        rect: { x: margin, y: Math.round(ch * 0.11), width: Math.round(cw * 0.55), height: Math.round(ch * 0.18) },
        props: {
          text: 'Lesson title', fontSize: Math.round(cw * 0.037), fontWeight: 700, align: 'left',
          color: '#ffffff', lineHeight: 1.15, background: 'transparent',
        },
      };
    case 'image':
      return {
        name: 'Image',
        rect: { x: margin, y: margin, width: Math.round(cw * 0.35), height: Math.round(ch * 0.35) },
        props: { fit: 'contain', radius: 12, zoom: 1, panX: 0, panY: 0 },
      };
    case 'color':
      return { name: 'Colour block', rect: { x: 0, y: 0, width: cw, height: ch }, props: { background: '#0b1a2b', radius: 0 } };
    case 'chord':
    default:
      return {
        name: 'Chord readout',
        rect: {
          x: margin, y: Math.round(ch * 0.52),
          width: Math.round(cw * 0.3), height: Math.round(ch * 0.15),
        },
        props: {
          color: '#ffffff', fontSize: Math.round(cw * 0.044), background: 'rgba(6,16,26,0.72)',
          chordMode: 'both', numeralScale: 0.5, align: 'left', radius: 14,
        },
      };
  }
}

export function createSource(
  kind: SourceKind,
  canvas: CanvasSize = LANDSCAPE_CANVAS,
  overrides: Partial<Source> = {},
): Source {
  const preset = sourceDefaults(kind, canvas);
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

/**
 * A real white key is roughly 23mm wide and 150mm long, about 1:6.5. Holding
 * that ratio is what makes a keyboard read as an instrument seen from a
 * distance rather than a row of slivers — which is what an 88-key board becomes
 * when it is stretched to the height of a portrait canvas.
 */
export const WHITE_KEY_RATIO = 6.5;

/** Count the white keys in a range. */
export function whiteKeyCount(firstNote: number, lastNote: number): number {
  let count = 0;
  for (let note = firstNote; note <= lastNote; note++) {
    if (![1, 3, 6, 8, 10].includes(((note % 12) + 12) % 12)) count++;
  }
  return Math.max(1, count);
}

/**
 * The height at which a keyboard of this width and range looks like a real
 * instrument. Callouts above the keys need their own room, so the strip is
 * included when they are shown.
 */
export function naturalKeyboardHeight(
  width: number,
  firstNote = 21,
  lastNote = 108,
  withCallouts = true,
): number {
  const keyWidth = width / whiteKeyCount(firstNote, lastNote);
  const keys = keyWidth * WHITE_KEY_RATIO;
  // drawKeyboard reserves a fifth of the box for the callout strip and a
  // twentieth for the felt, so the keys themselves get about three quarters.
  return Math.round(withCallouts ? keys / 0.755 : keys / 0.955);
}

/**
 * Default frame for a camera role, proportioned to the canvas.
 *
 * A face shot is a 16:9 box in the upper area. A hand shot is the wide, short
 * strip an overhead camera actually produces looking along a keyboard, so it
 * spans the width.
 */
export function cameraRoleRect(role: CameraRole, canvas: CanvasSize = LANDSCAPE_CANVAS): Rect {
  const { width: cw, height: ch } = canvas;
  const margin = Math.round(Math.min(cw, ch) * 0.035);
  if (role === 'hand') {
    const width = cw - margin * 2;
    return { x: margin, y: Math.round(ch * 0.44), width, height: Math.round(width * 0.26) };
  }
  const width = Math.round(cw * (canvas.height > canvas.width ? 0.9 : 0.42));
  return { x: Math.round(cw - margin - width), y: margin, width, height: Math.round(width * 9 / 16) };
}

/** Build a camera source for a teaching role, shaped to suit it. */
export function createCameraSource(
  role: CameraRole,
  deviceId?: string,
  name?: string,
  canvas: CanvasSize = LANDSCAPE_CANVAS,
): Source {
  const label = name ?? (role === 'hand' ? 'Hand camera' : role === 'face' ? 'Face camera' : 'Camera');
  return createSource('camera', canvas, {
    name: label,
    ...cameraRoleRect(role, canvas),
    props: {
      deviceId,
      role,
      fit: 'cover',
      // A face shot is usually mirrored so the teacher's movements read naturally;
      // an overhead hand shot must not be, or the keyboard would run backwards.
      mirror: role === 'face',
      radius: role === 'hand' ? 10 : 18,
      zoom: 1, panX: 0, panY: 0,
    },
  });
}

/** A new scene starts empty — the teacher builds their own layout. */
export function createScene(name: string): Scene {
  return { id: createId('scene'), name, layouts: {} };
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const MIN_SIZE = 40;

const round = (value: number) => Math.round(value);

/** Keep a rect inside the canvas without changing its size. */
export function clampToCanvas(rect: Rect, canvas: CanvasSize = LANDSCAPE_CANVAS): Rect {
  const width = Math.min(rect.width, canvas.width);
  const height = Math.min(rect.height, canvas.height);
  return {
    width,
    height,
    x: Math.max(0, Math.min(canvas.width - width, rect.x)),
    y: Math.max(0, Math.min(canvas.height - height, rect.y)),
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
  canvas: CanvasSize = LANDSCAPE_CANVAS,
  threshold = 12,
): { rect: Rect; guides: SnapGuide[] } {
  const guides: SnapGuide[] = [];
  let { x, y } = rect;

  const verticalTargets = [0, canvas.width / 2, canvas.width];
  const horizontalTargets = [0, canvas.height / 2, canvas.height];
  others.forEach(other => {
    verticalTargets.push(other.x, other.x + other.width / 2, other.x + other.width);
    horizontalTargets.push(other.y, other.y + other.height / 2, other.y + other.height);
  });

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

/** Move an item within a list. Works for both sources and scenes. */
export function reorderBy<T>(items: T[], index: number, direction: ReorderDirection): T[] {
  if (index < 0 || index >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  const target =
    direction === 'top' ? next.length
      : direction === 'bottom' ? 0
        : direction === 'up' ? Math.min(next.length, index + 1)
          : Math.max(0, index - 1);
  next.splice(target, 0, item);
  return next;
}

export function reorder(sources: Source[], id: string, direction: ReorderDirection): Source[] {
  const index = sources.findIndex(source => source.id === id);
  if (index < 0) return sources;
  return reorderBy(sources, index, direction);
}

/** Stretch a source to fill the whole canvas. */
export const fillCanvas = (canvas: CanvasSize = LANDSCAPE_CANVAS): Rect =>
  ({ x: 0, y: 0, width: canvas.width, height: canvas.height });

/** Centre a rect without resizing it. */
export function centreRect(rect: Rect, canvas: CanvasSize = LANDSCAPE_CANVAS): Rect {
  return {
    ...rect,
    x: round((canvas.width - rect.width) / 2),
    y: round((canvas.height - rect.height) / 2),
  };
}

/**
 * Scale a rect to fit the canvas while keeping `ratio` (width / height),
 * then centre it — the equivalent of "Fit to screen".
 */
export function fitToCanvas(ratio: number, canvas: CanvasSize = LANDSCAPE_CANVAS): Rect {
  const canvasRatio = canvas.width / canvas.height;
  const width = ratio >= canvasRatio ? canvas.width : round(canvas.height * ratio);
  const height = ratio >= canvasRatio ? round(canvas.width / ratio) : canvas.height;
  return centreRect({ x: 0, y: 0, width, height }, canvas);
}

/**
 * Proportionally re-fit a layout built for one canvas onto another. Used when
 * seeding a format's layout from an existing one, so a portrait version starts
 * from the landscape arrangement rather than from nothing.
 */
export function rescaleLayout(sources: Source[], from: CanvasSize, to: CanvasSize): Source[] {
  // Use the smaller axis ratio so nothing grows off the canvas.
  const scale = Math.min(to.width / from.width, to.height / from.height);
  return sources.map(source => {
    const width = Math.max(MIN_SIZE, round(source.width * scale));
    const height = Math.max(MIN_SIZE, round(source.height * scale));
    // Keep each source's relative position, then clamp it into the new frame.
    const centreX = (source.x + source.width / 2) / from.width;
    const centreY = (source.y + source.height / 2) / from.height;
    return {
      ...source,
      ...clampToCanvas({
        x: round(centreX * to.width - width / 2),
        y: round(centreY * to.height - height / 2),
        width, height,
      }, to),
      props: {
        ...source.props,
        // Font sizes are in layout units, so they scale with the canvas too.
        ...(source.props.fontSize ? { fontSize: Math.max(8, round(source.props.fontSize * scale)) } : {}),
      },
    };
  });
}

/* ------------------------------------------------------------------ *
 * Serialisation
 * ------------------------------------------------------------------ */

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const VALID_KINDS: SourceKind[] = ['camera', 'keyboard', 'staff', 'fretboard', 'notes', 'text', 'image', 'color', 'chord', 'backdrop'];

function normalizeSource(item: unknown): Source | null {
  if (!item || typeof item !== 'object') return null;
  const source = item as Partial<Source>;
  if (typeof source.kind !== 'string' || !VALID_KINDS.includes(source.kind as SourceKind)) return null;
  if (!isFiniteNumber(source.x) || !isFiniteNumber(source.y)) return null;
  if (!isFiniteNumber(source.width) || !isFiniteNumber(source.height)) return null;
  return {
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
  };
}

/**
 * Rebuild a scene list from stored JSON, discarding anything malformed.
 *
 * Scenes saved before per-format layouts carried a flat `sources` array; those
 * are read in as the landscape layout so existing work is not lost.
 */
export function normalizeScenes(raw: unknown): Scene[] {
  if (!Array.isArray(raw)) return [];
  const scenes: Scene[] = [];

  raw.forEach(entry => {
    if (!entry || typeof entry !== 'object') return;
    const candidate = entry as Partial<Scene> & { sources?: unknown };
    if (typeof candidate.name !== 'string') return;

    const layouts: SceneLayouts = {};

    if (candidate.layouts && typeof candidate.layouts === 'object') {
      Object.entries(candidate.layouts as Record<string, unknown>).forEach(([formatId, list]) => {
        if (!Array.isArray(list)) return;
        if (getFormat(formatId).id !== formatId) return;
        layouts[formatId as OutputFormatId] = list
          .map(normalizeSource)
          .filter((source): source is Source => source !== null);
      });
    }

    // Legacy flat layout.
    if (!Object.keys(layouts).length && Array.isArray(candidate.sources)) {
      layouts[DEFAULT_FORMAT] = candidate.sources
        .map(normalizeSource)
        .filter((source): source is Source => source !== null);
    }

    scenes.push({
      id: typeof candidate.id === 'string' ? candidate.id : createId('scene'),
      name: candidate.name,
      layouts,
    });
  });

  return scenes;
}
