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
import { clefShapes } from './clefs';

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
 * Paint a clef at a given point, filled rather than stroked.
 *
 * The shapes come from ./clefs as outlines in staff spaces, so they scale with
 * the staff and land with their anchor — the eye of the treble clef, the head
 * of the bass clef — exactly on the line each one names.
 */
function drawClef(
  ctx: CanvasRenderingContext2D,
  clef: Clef,
  x: number,
  y: number,
  u: number,
  ink: string,
): void {
  const { ribbon, discs } = clefShapes(clef);
  ctx.fillStyle = ink;

  if (ribbon.length > 2) {
    ctx.beginPath();
    ctx.moveTo(x + ribbon[0][0] * u, y + ribbon[0][1] * u);
    for (let i = 1; i < ribbon.length; i += 1) {
      ctx.lineTo(x + ribbon[i][0] * u, y + ribbon[i][1] * u);
    }
    ctx.closePath();
    ctx.fill();
  }

  discs.forEach(disc => {
    ctx.beginPath();
    ctx.arc(x + disc.x * u, y + disc.y * u, disc.r * u, 0, Math.PI * 2);
    ctx.fill();
  });
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
  const clefX = left + geometry.space * 2.1;
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

  if (clef === 'treble') {
    // The eye of the G clef sits on the second line up, which is G4.
    drawClef(ctx, 'treble', clefX, stepY(lines[1], geometry), geometry.space, ink);
  } else {
    // The head of the F clef sits on the second line down, which is F3.
    drawClef(ctx, 'bass', clefX - geometry.space * 0.1, stepY(lines[3], geometry), geometry.space, ink);
  }
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
