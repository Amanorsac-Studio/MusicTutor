/**
 * Backdrop presets.
 *
 * Each preset is defined once, with a CSS form for the editor preview and a
 * canvas form for the recording, so what you arrange is what gets recorded.
 */

export type BackdropId = 'studio' | 'blue' | 'wood' | 'room' | 'violet' | 'mountain' | 'charcoal' | 'sunrise';

export type BackdropStop = { offset: number; color: string };

export type Backdrop = {
  id: BackdropId;
  name: string;
  css: string;
  /** How the canvas gradient is laid out, in fractions of the source box. */
  canvas:
    | { type: 'linear'; from: [number, number]; to: [number, number]; stops: BackdropStop[] }
    | { type: 'radial'; centre: [number, number]; radius: number; stops: BackdropStop[] };
};

export const BACKDROPS: Backdrop[] = [
  {
    id: 'studio',
    name: 'Studio',
    css: 'radial-gradient(circle at 50% 80%,#d98229,#13233c 32%,#050a11 70%)',
    canvas: {
      type: 'radial', centre: [0.5, 0.8], radius: 1.05,
      stops: [{ offset: 0, color: '#d98229' }, { offset: 0.32, color: '#13233c' }, { offset: 0.7, color: '#050a11' }],
    },
  },
  {
    id: 'blue',
    name: 'Blue',
    css: 'linear-gradient(140deg,#072864,#168aec,#081630)',
    canvas: {
      type: 'linear', from: [0.1, 0], to: [0.9, 1],
      stops: [{ offset: 0, color: '#072864' }, { offset: 0.5, color: '#168aec' }, { offset: 1, color: '#081630' }],
    },
  },
  {
    id: 'wood',
    name: 'Wood',
    css: 'linear-gradient(90deg,#392315,#a36229,#2a180e)',
    canvas: {
      type: 'linear', from: [0, 0.5], to: [1, 0.5],
      stops: [{ offset: 0, color: '#392315' }, { offset: 0.5, color: '#a36229' }, { offset: 1, color: '#2a180e' }],
    },
  },
  {
    id: 'room',
    name: 'Room',
    css: 'linear-gradient(135deg,#315038,#d9c8a2 45%,#415b45)',
    canvas: {
      type: 'linear', from: [0, 0], to: [1, 1],
      stops: [{ offset: 0, color: '#315038' }, { offset: 0.45, color: '#d9c8a2' }, { offset: 1, color: '#415b45' }],
    },
  },
  {
    id: 'violet',
    name: 'Violet',
    css: 'linear-gradient(135deg,#341668,#a81fda,#1971cf)',
    canvas: {
      type: 'linear', from: [0, 0], to: [1, 1],
      stops: [{ offset: 0, color: '#341668' }, { offset: 0.5, color: '#a81fda' }, { offset: 1, color: '#1971cf' }],
    },
  },
  {
    id: 'mountain',
    name: 'Mountain',
    css: 'linear-gradient(#8ac5e4 45%,#d4d9d8 46%,#426858)',
    canvas: {
      type: 'linear', from: [0.5, 0], to: [0.5, 1],
      stops: [
        { offset: 0, color: '#8ac5e4' }, { offset: 0.45, color: '#8ac5e4' },
        { offset: 0.46, color: '#d4d9d8' }, { offset: 1, color: '#426858' },
      ],
    },
  },
  {
    id: 'charcoal',
    name: 'Charcoal',
    css: 'radial-gradient(circle at 30% 20%,#2b3947,#141d27 45%,#080d13 100%)',
    canvas: {
      type: 'radial', centre: [0.3, 0.2], radius: 1.15,
      stops: [{ offset: 0, color: '#2b3947' }, { offset: 0.45, color: '#141d27' }, { offset: 1, color: '#080d13' }],
    },
  },
  {
    id: 'sunrise',
    name: 'Sunrise',
    css: 'linear-gradient(160deg,#2a1b4a,#c2497a 55%,#f7a44b)',
    canvas: {
      type: 'linear', from: [0.15, 0], to: [0.85, 1],
      stops: [{ offset: 0, color: '#2a1b4a' }, { offset: 0.55, color: '#c2497a' }, { offset: 1, color: '#f7a44b' }],
    },
  },
];

export const DEFAULT_BACKDROP: BackdropId = 'studio';

export function findBackdrop(id: string | undefined): Backdrop {
  return BACKDROPS.find(backdrop => backdrop.id === id) ?? BACKDROPS[0];
}

/** Paint a backdrop into a box on a 2D canvas. */
export function paintBackdrop(
  ctx: CanvasRenderingContext2D,
  backdrop: Backdrop,
  width: number,
  height: number,
): void {
  const spec = backdrop.canvas;
  let gradient: CanvasGradient;
  if (spec.type === 'linear') {
    gradient = ctx.createLinearGradient(
      spec.from[0] * width, spec.from[1] * height,
      spec.to[0] * width, spec.to[1] * height,
    );
  } else {
    const radius = spec.radius * Math.max(width, height) * 0.5;
    gradient = ctx.createRadialGradient(
      spec.centre[0] * width, spec.centre[1] * height, 0,
      spec.centre[0] * width, spec.centre[1] * height, Math.max(1, radius),
    );
  }
  spec.stops.forEach(stop => gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}
