/**
 * The note display: what is sounding, in type big enough to read from a phone.
 *
 * The same function paints the editor preview and the recording.
 *
 * The size is worked out from the box rather than fixed. One note fills it; a
 * five-note chord shrinks until it fits on one line, because a label that wraps
 * or runs off the edge mid-lesson is worse than a smaller one.
 */

export type NotesOptions = {
  /** Already labelled, low to high. */
  labels: string[];
  /** Shown small in a corner, so a viewer knows which system they are reading. */
  caption: string;
  color: string;
  accent: string;
  /** Background; 'transparent' leaves whatever is underneath. */
  background: string;
  align: 'left' | 'center' | 'right';
  /** What to show when nothing is sounding. Empty leaves the box blank. */
  idle: string;
};

/** The largest font size at which a line fits a width, found by measuring. */
export function fitFontSize(
  measure: (size: number) => number, maxWidth: number, maxSize: number, minSize = 8,
): number {
  if (maxSize <= minSize) return minSize;
  const width = measure(maxSize);
  if (width <= maxWidth || width <= 0) return maxSize;
  // Text width scales linearly with font size, so one measurement is enough.
  return Math.max(minSize, Math.floor(maxSize * (maxWidth / width)));
}

export function drawNotes(
  ctx: CanvasRenderingContext2D,
  box: { width: number; height: number },
  options: NotesOptions,
): void {
  const { width, height } = box;
  if (width <= 0 || height <= 0) return;

  if (options.background && options.background !== 'transparent') {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, width, height);
  }

  const pad = Math.min(width, height) * 0.1;
  const captionSize = Math.max(9, height * 0.11);

  if (options.caption) {
    ctx.fillStyle = options.accent;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${captionSize}px Inter, system-ui, sans-serif`;
    ctx.fillText(options.caption.toUpperCase(), pad, pad * 0.6);
  }

  const sounding = options.labels.length > 0;
  const line = sounding ? options.labels.join('  ') : options.idle;
  if (!line) return;

  const family = 'Inter, system-ui, sans-serif';
  const room = width - pad * 2;
  // The idle mark is a placeholder, not a reading, so it stays small and out
  // of the way rather than filling the box the way a note does.
  const tallest = (height - pad - captionSize) * (sounding ? 0.78 : 0.3);
  const size = fitFontSize(candidate => {
    ctx.font = `800 ${candidate}px ${family}`;
    return ctx.measureText(line).width;
  }, room, tallest);

  ctx.font = `800 ${size}px ${family}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = options.align;
  ctx.fillStyle = sounding ? options.color : 'rgba(190,205,220,0.35)';
  if (sounding) {
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = size * 0.12;
  }
  const x = options.align === 'center' ? width / 2 : options.align === 'right' ? width - pad : pad;
  const y = captionSize + pad * 0.4 + (height - captionSize - pad * 0.4) / 2;
  ctx.fillText(line, x, y);
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}
