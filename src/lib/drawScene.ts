/**
 * Canvas renderer for a scene.
 *
 * The recording is produced from this, not from a screen grab, so the output is
 * exactly the 1920x1080 composition — no app chrome, no panels, and the same
 * frame whatever size the window happens to be.
 */

import { LANDSCAPE_CANVAS, type Source } from './scene';
import type { CanvasSize } from './formats';
import { isBlackKey, noteName, octaveOf, pitchClass, type Accidental } from './chords';
import { cameraHub } from './cameraHub';
import { findBackdrop, paintBackdrop } from './backdrops';

export type RenderContext = {
  /** Notes currently sounding, for the keyboard and chord readout. */
  activeNotes: Set<number>;
  accidental: Accidental;
  /** Pre-formatted chord readout lines. */
  chordSymbol?: string;
  chordNumeral?: string;
  chordQuality?: string;
  /** Images already loaded and ready to draw, keyed by source id. */
  images: Map<string, CanvasImageSource>;
};

const roundedPath = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

/** Geometry for drawing an image into a box under a fit mode. */
export function fitRect(
  sourceWidth: number, sourceHeight: number,
  boxWidth: number, boxHeight: number,
  fit: 'cover' | 'contain' | 'stretch',
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  if (fit === 'stretch' || !sourceWidth || !sourceHeight) {
    return { sx: 0, sy: 0, sw: sourceWidth || 1, sh: sourceHeight || 1, dx: 0, dy: 0, dw: boxWidth, dh: boxHeight };
  }
  const sourceRatio = sourceWidth / sourceHeight;
  const boxRatio = boxWidth / boxHeight;

  if (fit === 'cover') {
    // Crop the overflowing axis so the box is filled completely.
    if (sourceRatio > boxRatio) {
      const sw = sourceHeight * boxRatio;
      return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight, dx: 0, dy: 0, dw: boxWidth, dh: boxHeight };
    }
    const sh = sourceWidth / boxRatio;
    return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh, dx: 0, dy: 0, dw: boxWidth, dh: boxHeight };
  }

  // contain: letterbox inside the box
  if (sourceRatio > boxRatio) {
    const dh = boxWidth / sourceRatio;
    return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight, dx: 0, dy: (boxHeight - dh) / 2, dw: boxWidth, dh };
  }
  const dw = boxHeight * sourceRatio;
  return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight, dx: (boxWidth - dw) / 2, dy: 0, dw, dh: boxHeight };
}

/**
 * Push in on a picture. `zoom` 1 shows the whole frame, 2 shows the middle
 * half. `panX`/`panY` slide the visible window across the cropped-away area,
 * from -1 (hard left/top) through 0 (centred) to 1.
 */
export function applyZoom(
  geometry: { sx: number; sy: number; sw: number; sh: number },
  zoom = 1,
  panX = 0,
  panY = 0,
): { sx: number; sy: number; sw: number; sh: number } {
  const factor = Math.max(1, zoom);
  if (factor === 1) return geometry;
  const sw = geometry.sw / factor;
  const sh = geometry.sh / factor;
  // The pan range is whatever the crop left over on each axis.
  const slackX = (geometry.sw - sw) / 2;
  const slackY = (geometry.sh - sh) / 2;
  const clamp = (value: number) => Math.min(1, Math.max(-1, value));
  return {
    sx: geometry.sx + slackX + clamp(panX) * slackX,
    sy: geometry.sy + slackY + clamp(panY) * slackY,
    sw,
    sh,
  };
}

/** Wrap text to a width, honouring explicit newlines. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  text.split('\n').forEach(paragraph => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); return; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${line} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
      else { lines.push(line); line = words[i]; }
    }
    lines.push(line);
  });
  return lines;
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

/**
 * Draw a piano keyboard into a box. Shared by the recording compositor so the
 * program output matches the interactive preview.
 */
export function drawKeyboard(
  ctx: CanvasRenderingContext2D,
  box: { width: number; height: number },
  options: {
    firstNote: number; lastNote: number; active: Set<number>;
    accent: string; accidental: Accidental; showLabels: 'none' | 'c-only' | 'all';
    /** Name each sounding note above the key, as a teaching callout. */
    namePlayed?: boolean;
  },
): void {
  const { firstNote, lastNote, active, accent, accidental, showLabels, namePlayed } = options;
  const whites: number[] = [];
  const blacks: number[] = [];
  for (let note = firstNote; note <= lastNote; note++) {
    if (isBlackKey(note)) blacks.push(note);
    else whites.push(note);
  }
  if (!whites.length) return;

  // A callout strip above the keys, when note names are being shown.
  const calloutHeight = namePlayed ? box.height * 0.16 : 0;
  const feltHeight = Math.max(3, box.height * 0.045);
  const keyTop = calloutHeight + feltHeight;
  const keyHeight = box.height - keyTop;
  const whiteWidth = box.width / whites.length;

  // Felt strip along the top, as on a real instrument.
  const felt = ctx.createLinearGradient(0, calloutHeight, 0, calloutHeight + feltHeight);
  felt.addColorStop(0, '#8d1f2d');
  felt.addColorStop(1, '#5c1220');
  ctx.fillStyle = felt;
  ctx.fillRect(0, calloutHeight, box.width, feltHeight);

  // White keys
  whites.forEach((note, index) => {
    const x = index * whiteWidth;
    const isActive = active.has(note);
    if (isActive) {
      ctx.fillStyle = accent;
    } else {
      const gradient = ctx.createLinearGradient(0, keyTop, 0, keyTop + keyHeight);
      gradient.addColorStop(0, '#fdfefe');
      gradient.addColorStop(0.78, '#eef3f8');
      gradient.addColorStop(1, '#d6dfe8');
      ctx.fillStyle = gradient;
    }
    ctx.fillRect(x, keyTop, whiteWidth - 1, keyHeight);
    ctx.strokeStyle = '#26364a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, keyTop + 0.5, whiteWidth - 2, keyHeight - 1);

    const wantsLabel = showLabels === 'all' || (showLabels === 'c-only' && pitchClass(note) === 0);
    if (wantsLabel && whiteWidth > 14) {
      ctx.fillStyle = isActive ? '#0b1a28' : '#7b8b9d';
      ctx.font = `600 ${Math.min(whiteWidth * 0.42, keyHeight * 0.12)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const label = showLabels === 'all' ? noteName(note, accidental) : `C${octaveOf(note)}`;
      ctx.fillText(label, x + whiteWidth / 2, keyTop + keyHeight - keyHeight * 0.04);
    }
  });

  // Black keys sit on the boundaries between their neighbours.
  const nudge: Record<number, number> = { 1: -0.09, 3: 0.09, 6: -0.11, 8: 0, 10: 0.11 };
  const blackWidth = whiteWidth * 0.62;
  const blackHeight = keyHeight * 0.62;
  blacks.forEach(note => {
    let below = note - 1;
    while (below >= firstNote && isBlackKey(below)) below--;
    const whiteIndex = whites.indexOf(below);
    if (whiteIndex < 0) return;
    const centre = (whiteIndex + 1 + (nudge[pitchClass(note)] ?? 0)) * whiteWidth;
    const x = centre - blackWidth / 2;
    const isActive = active.has(note);
    if (isActive) {
      ctx.fillStyle = accent;
    } else {
      const gradient = ctx.createLinearGradient(0, keyTop, 0, keyTop + blackHeight);
      gradient.addColorStop(0, '#2b3745');
      gradient.addColorStop(0.62, '#131c26');
      gradient.addColorStop(1, '#080d13');
      ctx.fillStyle = gradient;
    }
    roundedPath(ctx, x, keyTop, blackWidth, blackHeight, Math.min(4, blackWidth / 4));
    ctx.fill();
  });

  if (!namePlayed || !active.size) return;

  // Name each sounding note above its key. Drawn last so nothing covers it.
  const centreOf = (note: number): number | null => {
    if (!isBlackKey(note)) {
      const index = whites.indexOf(note);
      return index < 0 ? null : (index + 0.5) * whiteWidth;
    }
    let below = note - 1;
    while (below >= firstNote && isBlackKey(below)) below--;
    const whiteIndex = whites.indexOf(below);
    if (whiteIndex < 0) return null;
    return (whiteIndex + 1 + (nudge[pitchClass(note)] ?? 0)) * whiteWidth;
  };

  const fontSize = Math.min(calloutHeight * 0.78, box.width * 0.05);
  ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  [...active].sort((a, b) => a - b).forEach(note => {
    const centre = centreOf(note);
    if (centre === null) return;
    ctx.fillStyle = accent;
    ctx.fillText(noteName(note, accidental), centre, calloutHeight * 0.5);
  });
}

/* ------------------------------------------------------------------ *
 * Sources
 * ------------------------------------------------------------------ */

function drawSource(ctx: CanvasRenderingContext2D, source: Source, context: RenderContext): void {
  const { width, height, props } = source;
  const radius = props.radius ?? 0;

  if (radius > 0) {
    roundedPath(ctx, 0, 0, width, height, radius);
    ctx.clip();
  }

  switch (source.kind) {
    case 'backdrop': {
      paintBackdrop(ctx, findBackdrop(props.backdrop), width, height);
      break;
    }

    case 'color': {
      ctx.fillStyle = props.background ?? '#0b1a2b';
      ctx.fillRect(0, 0, width, height);
      break;
    }

    case 'camera': {
      const element = props.deviceId ? cameraHub.element(props.deviceId) : undefined;
      const ready = element && element.readyState >= 2 && element.videoWidth > 0;
      if (!ready) {
        ctx.fillStyle = '#08131e';
        ctx.fillRect(0, 0, width, height);
        break;
      }
      const fitted = fitRect(element.videoWidth, element.videoHeight, width, height, props.fit ?? 'cover');
      const zoomed = applyZoom(fitted, props.zoom, props.panX, props.panY);
      const geometry = { ...fitted, ...zoomed };
      ctx.save();
      if (props.mirror) {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(
        element,
        geometry.sx, geometry.sy, geometry.sw, geometry.sh,
        geometry.dx, geometry.dy, geometry.dw, geometry.dh,
      );
      ctx.restore();
      break;
    }

    case 'image': {
      const image = context.images.get(source.id);
      if (!image) {
        ctx.fillStyle = '#0d1a26';
        ctx.fillRect(0, 0, width, height);
        break;
      }
      const naturalWidth = (image as HTMLImageElement).naturalWidth || width;
      const naturalHeight = (image as HTMLImageElement).naturalHeight || height;
      const fitted = fitRect(naturalWidth, naturalHeight, width, height, props.fit ?? 'contain');
      const geometry = { ...fitted, ...applyZoom(fitted, props.zoom, props.panX, props.panY) };
      ctx.drawImage(
        image,
        geometry.sx, geometry.sy, geometry.sw, geometry.sh,
        geometry.dx, geometry.dy, geometry.dw, geometry.dh,
      );
      break;
    }

    case 'text': {
      if (props.background && props.background !== 'transparent') {
        ctx.fillStyle = props.background;
        ctx.fillRect(0, 0, width, height);
      }
      const fontSize = props.fontSize ?? 72;
      const weight = props.fontWeight ?? 700;
      ctx.font = `${weight} ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = props.color ?? '#ffffff';
      ctx.textBaseline = 'top';
      const align = props.align ?? 'left';
      ctx.textAlign = align;
      const lines = wrapText(ctx, props.text ?? '', width);
      const lineHeight = fontSize * (props.lineHeight ?? 1.15);
      const originX = align === 'center' ? width / 2 : align === 'right' ? width : 0;
      // Vertically centre the block within its box.
      const startY = Math.max(0, (height - lines.length * lineHeight) / 2);
      lines.forEach((line, index) => ctx.fillText(line, originX, startY + index * lineHeight));
      break;
    }

    case 'chord': {
      if (props.background && props.background !== 'transparent') {
        ctx.fillStyle = props.background;
        ctx.fillRect(0, 0, width, height);
      }
      const mode = props.chordMode ?? 'both';
      const align = props.align ?? 'left';
      const padding = Math.min(width, height) * 0.1;
      const originX = align === 'center' ? width / 2 : align === 'right' ? width - padding : padding;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';

      const name = context.chordSymbol || '—';
      const numeral = context.chordNumeral || '';
      const base = props.fontSize ?? 84;
      // The numeral can be scaled up past the chord name, for teachers who
      // think in degrees rather than letters.
      const numeralSize = base * Math.min(3, Math.max(0.2, props.numeralScale ?? 0.5));

      const showName = mode !== 'numerals';
      const showNumeral = mode !== 'names' && Boolean(numeral);

      if (showName && showNumeral) {
        const gap = (base + numeralSize) * 0.06;
        const block = base + numeralSize + gap;
        const top = height / 2 - block / 2;
        ctx.fillStyle = props.color ?? '#ffffff';
        ctx.font = `700 ${base}px Inter, system-ui, sans-serif`;
        ctx.fillText(name, originX, top + base / 2);
        ctx.fillStyle = '#7fc4ff';
        ctx.font = `700 ${numeralSize}px Inter, system-ui, sans-serif`;
        ctx.fillText(numeral, originX, top + base + gap + numeralSize / 2);
      } else if (showNumeral) {
        ctx.fillStyle = '#7fc4ff';
        ctx.font = `700 ${numeralSize}px Inter, system-ui, sans-serif`;
        ctx.fillText(numeral, originX, height / 2);
      } else {
        ctx.fillStyle = props.color ?? '#ffffff';
        ctx.font = `700 ${base}px Inter, system-ui, sans-serif`;
        ctx.fillText(name, originX, height / 2);
      }
      break;
    }

    case 'keyboard': {
      drawKeyboard(ctx, { width, height }, {
        firstNote: props.firstNote ?? 21,
        lastNote: props.lastNote ?? 108,
        active: context.activeNotes,
        accent: props.accent ?? '#1d9cff',
        accidental: context.accidental,
        showLabels: props.showLabels ?? 'c-only',
        namePlayed: props.namePlayed !== false,
      });
      break;
    }

    default:
      break;
  }
}

/** Paint a whole scene. Sources are drawn bottom-up. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  sources: Source[],
  context: RenderContext,
  canvas: CanvasSize = LANDSCAPE_CANVAS,
  background = '#050d15',
): void {
  ctx.save();
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  sources.forEach(source => {
    if (!source.visible || source.opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = source.opacity;
    ctx.translate(source.x, source.y);
    drawSource(ctx, source, context);
    ctx.restore();
  });
}
