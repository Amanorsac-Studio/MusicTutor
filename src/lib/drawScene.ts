/**
 * Canvas renderer for a scene.
 *
 * The recording is produced from this, not from a screen grab, so the output is
 * exactly the 1920x1080 composition — no app chrome, no panels, and the same
 * frame whatever size the window happens to be.
 */

import { CANVAS_HEIGHT, CANVAS_WIDTH, type Source } from './scene';
import { isBlackKey, noteName, octaveOf, pitchClass, type Accidental } from './chords';
import { cameraHub } from './cameraHub';

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
  },
): void {
  const { firstNote, lastNote, active, accent, accidental, showLabels } = options;
  const whites: number[] = [];
  const blacks: number[] = [];
  for (let note = firstNote; note <= lastNote; note++) {
    if (isBlackKey(note)) blacks.push(note);
    else whites.push(note);
  }
  if (!whites.length) return;

  const feltHeight = Math.max(3, box.height * 0.045);
  const keyTop = feltHeight;
  const keyHeight = box.height - feltHeight;
  const whiteWidth = box.width / whites.length;

  // Felt strip along the top, as on a real instrument.
  const felt = ctx.createLinearGradient(0, 0, 0, feltHeight);
  felt.addColorStop(0, '#8d1f2d');
  felt.addColorStop(1, '#5c1220');
  ctx.fillStyle = felt;
  ctx.fillRect(0, 0, box.width, feltHeight);

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
      const geometry = fitRect(element.videoWidth, element.videoHeight, width, height, props.fit ?? 'cover');
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
      const geometry = fitRect(naturalWidth, naturalHeight, width, height, props.fit ?? 'contain');
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
      const fontSize = props.fontSize ?? 84;
      const align = props.align ?? 'left';
      const padding = Math.min(width, height) * 0.1;
      const originX = align === 'center' ? width / 2 : align === 'right' ? width - padding : padding;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = props.color ?? '#ffffff';
      ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
      const symbol = context.chordSymbol || '—';
      ctx.fillText(symbol, originX, height / 2 - (props.showRoman && context.chordNumeral ? fontSize * 0.22 : 0));
      if (props.showRoman && context.chordNumeral) {
        ctx.font = `700 ${fontSize * 0.42}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = '#7fc4ff';
        ctx.fillText(context.chordNumeral, originX, height / 2 + fontSize * 0.46);
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
  background = '#050d15',
): void {
  ctx.save();
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
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
