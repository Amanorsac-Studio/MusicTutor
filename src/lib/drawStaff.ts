/**
 * Grand-staff renderer.
 *
 * Draws the recent chords and whatever is sounding now. This is a live readout
 * rather than engraved notation: there are no rhythms or bar lines, because what
 * matters in a lesson is which notes make each chord and what came before it.
 *
 * The same function paints the editor preview and the recording, so the two
 * cannot drift apart.
 */

import {
  ledgerSteps, noteOffsets, placeNote, staffGeometry, staffLines, stepY,
  type Clef, type StaffGeometry,
} from './staff';

/** One vertical stack of notes: a chord, or what is held right now. */
export type StaffColumn = {
  id: string;
  notes: number[];
  /** Chord name or numeral written above the column. */
  label?: string;
  /** True for the notes sounding now, which are drawn in full colour. */
  live?: boolean;
};

export type StaffOptions = {
  /** Oldest first; the last column is the newest. */
  columns: StaffColumn[];
  accidental: 'sharp' | 'flat';
  /** Colour of sounding noteheads. */
  accent: string;
  /** Colour of the staff lines, clefs and settled noteheads. */
  ink: string;
  /** Background fill; 'transparent' leaves whatever is underneath. */
  paper: string;
  /** Write the chord name above each column. */
  showLabels: boolean;
};

/**
 * The treble clef, drawn as curves around the G line.
 *
 * A music font cannot be relied on to be installed, and the Unicode clefs come
 * out as empty boxes without one. The shape is defined in staff spaces with its
 * origin on the G line — the line the spiral encircles — so it lands correctly
 * whatever size the staff is drawn at.
 */
function traceTrebleClef(ctx: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  ctx.beginPath();
  // The tail below the staff, rising into the crossing.
  ctx.moveTo(x - 0.28 * u, y + 2.45 * u);
  ctx.bezierCurveTo(x + 0.45 * u, y + 2.7 * u, x + 0.72 * u, y + 1.85 * u, x + 0.22 * u, y + 1.35 * u);
  // Up the stem, leaning left as it climbs.
  ctx.bezierCurveTo(x - 0.7 * u, y + 0.6 * u, x - 0.95 * u, y - 0.9 * u, x - 0.2 * u, y - 2.1 * u);
  // Over the top hook and back down inside it.
  ctx.bezierCurveTo(x + 0.62 * u, y - 3.0 * u, x + 0.3 * u, y - 3.95 * u, x - 0.4 * u, y - 3.55 * u);
  ctx.bezierCurveTo(x - 1.05 * u, y - 3.18 * u, x - 0.88 * u, y - 1.9 * u, x - 0.1 * u, y - 0.95 * u);
  // Down through the staff and into the eye on the G line.
  ctx.bezierCurveTo(x + 0.5 * u, y - 0.1 * u, x + 0.95 * u, y + 0.55 * u, x + 0.5 * u, y + 0.95 * u);
  ctx.bezierCurveTo(x + 0.05 * u, y + 1.32 * u, x - 0.62 * u, y + 0.95 * u, x - 0.55 * u, y + 0.35 * u);
  ctx.bezierCurveTo(x - 0.5 * u, y - 0.1 * u, x - 0.12 * u, y - 0.28 * u, x + 0.08 * u, y - 0.05 * u);
  ctx.stroke();
}

/**
 * The bass clef: a comma curling down from the F line, with its two dots either
 * side of that line, which is how a reader finds F without counting.
 */
function traceBassClef(ctx: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  // A heavier stroke than the G clef: the F clef is a thick comma, and at the
  // size a staff is drawn on screen a thin one reads as a bracket.
  ctx.save();
  ctx.lineWidth = Math.max(1.6, u * 0.26);
  ctx.beginPath();
  // The upper terminal, then over the top of the head and down its left side.
  ctx.moveTo(x + 0.52 * u, y - 0.62 * u);
  ctx.bezierCurveTo(x + 0.22 * u, y - 1.18 * u, x - 0.72 * u, y - 1.05 * u, x - 0.66 * u, y - 0.28 * u);
  // Round the bottom of the head and back out to the right, almost closing it.
  ctx.bezierCurveTo(x - 0.6 * u, y + 0.42 * u, x + 0.16 * u, y + 0.68 * u, x + 0.5 * u, y + 0.22 * u);
  // The long tail sweeping down and left below the staff.
  ctx.bezierCurveTo(x + 1.15 * u, y + 1.05 * u, x + 0.45 * u, y + 2.1 * u, x - 0.95 * u, y + 2.5 * u);
  ctx.stroke();
  ctx.restore();

  const dot = 0.19 * u;
  ctx.beginPath();
  ctx.arc(x + 1.1 * u, y - 0.5 * u, dot, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 1.1 * u, y + 0.5 * u, dot, 0, Math.PI * 2);
  ctx.fill();
}

/** The five lines of one staff, plus its clef. */
function drawOneStaff(
  ctx: CanvasRenderingContext2D,
  clef: Clef,
  geometry: StaffGeometry,
  ink: string,
): void {
  const lines = staffLines(clef);
  const left = geometry.noteLeft * 0.08;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(1, geometry.space * 0.07);
  lines.forEach(step => {
    const y = stepY(step, geometry);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(geometry.right, y);
    ctx.stroke();
  });

  ctx.lineWidth = Math.max(1.2, geometry.space * 0.15);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (clef === 'treble') {
    // The eye of the G clef sits on the second line up, which is G4.
    traceTrebleClef(ctx, left + geometry.space * 1.5, stepY(lines[1], geometry), geometry.space);
  } else {
    // The head of the F clef sits on the second line down, which is F3.
    traceBassClef(ctx, left + geometry.space * 1.35, stepY(lines[3], geometry), geometry.space);
  }
  ctx.lineCap = 'butt';
}

/** Draw one chord as a stack of noteheads at a given horizontal position. */
function drawColumn(
  ctx: CanvasRenderingContext2D,
  column: StaffColumn,
  originX: number,
  geometry: StaffGeometry,
  options: StaffOptions,
  fade: number,
  labelRoom: number,
): void {
  if (!column.notes.length) return;
  const placements = column.notes.map(note => placeNote(note, options.accidental));
  const offsets = noteOffsets(placements);
  const headRadius = geometry.space * 0.52;

  ctx.save();
  ctx.globalAlpha = fade;

  placements.forEach((placement, index) => {
    const y = stepY(placement.step, geometry);
    const x = originX + offsets[index] * headRadius * 2.1;

    ctx.strokeStyle = options.ink;
    ctx.lineWidth = Math.max(1, geometry.space * 0.08);
    ledgerSteps(placement.step).forEach(step => {
      const lineY = stepY(step, geometry);
      ctx.beginPath();
      ctx.moveTo(x - headRadius * 1.8, lineY);
      ctx.lineTo(x + headRadius * 1.8, lineY);
      ctx.stroke();
    });

    // A slightly oval head, tilted, the way a notehead is actually shaped.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.34);
    ctx.beginPath();
    ctx.ellipse(0, 0, headRadius * 1.22, headRadius * 0.92, 0, 0, Math.PI * 2);
    ctx.fillStyle = column.live ? options.accent : options.ink;
    ctx.fill();
    ctx.restore();

    if (placement.accidental) {
      ctx.fillStyle = options.ink;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${geometry.space * 1.5}px Georgia, 'Times New Roman', serif`;
      ctx.fillText(placement.accidental, x - headRadius * 1.9, y);
    }
  });

  if (options.showLabels && column.label) {
    ctx.fillStyle = column.live ? options.accent : options.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // A slash chord is a long word, so the label shrinks to fit its own column
    // rather than running into the one beside it.
    let size = geometry.space * 1.05;
    ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
    const room = labelRoom;
    const measured = ctx.measureText(column.label).width;
    if (measured > room) {
      size = Math.max(geometry.space * 0.55, size * (room / measured));
      ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
    }
    ctx.fillText(column.label, originX, geometry.space * 0.2);
  }

  ctx.restore();
}

/**
 * Horizontal position of each column across the note area.
 *
 * Oldest at the left so a progression reads the way it was played, and a lone
 * column at the right where the newest chord always appears, rather than
 * jumping to the middle when the history is empty.
 */
export function columnPositions(count: number, geometry: StaffGeometry): number[] {
  if (count <= 0) return [];
  // A chord can spread one notehead to the right of its column and the label
  // above it is wider still, so the right margin is the larger of the two.
  const first = geometry.noteLeft + geometry.space * 1.6;
  const last = Math.max(first, geometry.right - geometry.space * 3.2);
  if (count === 1) return [last];
  const span = last - first;
  return Array.from({ length: count }, (_, index) => first + (span * index) / (count - 1));
}

/** How solid a column is drawn: the oldest half faded, the newest full. */
export const columnFade = (index: number, count: number): number =>
  (count <= 1 ? 1 : 0.45 + 0.55 * (index / (count - 1)));

export function drawStaff(
  ctx: CanvasRenderingContext2D,
  box: { width: number; height: number },
  options: StaffOptions,
): void {
  const { width, height } = box;
  if (width <= 0 || height <= 0) return;

  if (options.paper && options.paper !== 'transparent') {
    ctx.fillStyle = options.paper;
    ctx.fillRect(0, 0, width, height);
  }

  const geometry = staffGeometry(width, height);
  drawOneStaff(ctx, 'treble', geometry, options.ink);
  drawOneStaff(ctx, 'bass', geometry, options.ink);

  // The barline joining the two staves into one system.
  ctx.strokeStyle = options.ink;
  ctx.lineWidth = Math.max(1, geometry.space * 0.16);
  ctx.beginPath();
  ctx.moveTo(geometry.noteLeft * 0.08, stepY(38, geometry));
  ctx.lineTo(geometry.noteLeft * 0.08, stepY(18, geometry));
  ctx.stroke();

  const columns = options.columns.filter(column => column.notes.length);
  if (!columns.length) return;

  const positions = columnPositions(columns.length, geometry);
  // Labels may use the gap to the next column, less a little breathing space.
  const labelRoom = positions.length > 1
    ? (positions[1] - positions[0]) * 0.92
    : geometry.space * 6;
  columns.forEach((column, index) => {
    drawColumn(
      ctx, column, positions[index], geometry, options,
      columnFade(index, columns.length), labelRoom,
    );
  });
}
