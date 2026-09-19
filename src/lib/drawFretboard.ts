/**
 * Bass neck renderer.
 *
 * The same function paints the editor preview and the recording, so what a
 * teacher arranges is what the viewer sees.
 *
 * The neck is drawn the way tablature is written and the way a player sees it
 * looking down: lowest string at the bottom, nut at the left. Every position
 * the sounding note could be played at is marked, because the audio cannot say
 * which one was used, and the likeliest is filled in so the eye has somewhere
 * to land.
 */

import { noteName, type Accidental } from './chords';
import {
  DOUBLE_INLAYS, FRET_COUNT, INLAY_FRETS, clampFrets, noteDegree, positionsFor,
  type BassTuning, type FretPosition,
} from './fretboard';

/** One dot of a chord shape. */
export type NeckMark = { string: number; fret: number; label: string; root?: boolean };

export type FretboardOptions = {
  /** Any fretted instrument: only the open strings matter to the drawing. */
  tuning: Pick<BassTuning, 'strings'>;
  /**
   * A whole shape to show at once, for a chord. When given, it is drawn in
   * place of the single note, and `title` is what the readout says.
   */
  marks?: NeckMark[];
  /** Strings the shape leaves out, marked with a cross at the nut. */
  muted?: number[];
  title?: string;
  /** The sounding note, or null when nothing is playing. */
  midi: number | null;
  /** Which of its positions to fill in. */
  position: FretPosition | null;
  keyRoot: number;
  accidental: Accidental;
  accent: string;
  /** Background; 'transparent' leaves whatever is underneath. */
  background: string;
  /** Show the note name and its degree above the neck. */
  showReadout: boolean;
  /** How many frets to draw; twelve when not given. */
  frets?: number;
};

/**
 * Horizontal position of a fret's playing spot, as a fraction of the neck.
 *
 * Even spacing rather than the true logarithmic spacing of a real neck. On a
 * real neck the twelfth fret is half as wide as the first, which squeezes the
 * upper positions into a sliver on screen; for reading notes off a video, equal
 * boxes are clearer, and tablature makes the same choice.
 */
export const fretCentre = (fret: number, frets = FRET_COUNT): number =>
  (fret - 0.5) / frets;

export function drawFretboard(
  ctx: CanvasRenderingContext2D,
  box: { width: number; height: number },
  options: FretboardOptions,
): void {
  const { width, height } = box;
  if (width <= 0 || height <= 0) return;
  const { tuning } = options;
  const frets = clampFrets(options.frets);

  if (options.background && options.background !== 'transparent') {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, width, height);
  }

  const readout = options.showReadout ? height * 0.26 : 0;
  const pad = Math.min(width, height) * 0.06;
  // Room at the left for open-string markers, which sit behind the nut.
  const openRoom = Math.min(width * 0.08, (height - readout) * 0.3);
  const neckLeft = pad + openRoom;
  const neckRight = width - pad;
  const neckTop = readout + pad * 0.6;
  const neckBottom = height - pad * 1.5;
  const neckWidth = neckRight - neckLeft;
  const neckHeight = neckBottom - neckTop;
  const strings = tuning.strings.length;
  const stringY = (index: number) =>
    neckBottom - (neckHeight * (index + 0.5)) / strings;
  const fretX = (fret: number) => neckLeft + (neckWidth * fret) / frets;

  // The wood.
  ctx.fillStyle = '#2b1d14';
  ctx.fillRect(neckLeft, neckTop, neckWidth, neckHeight);

  // Inlay dots, which are how a player finds their place at a glance.
  ctx.fillStyle = 'rgba(235,225,205,0.32)';
  INLAY_FRETS.filter(fret => fret <= frets).forEach(fret => {
    const x = neckLeft + neckWidth * fretCentre(fret, frets);
    const radius = Math.min(neckHeight * 0.07, neckWidth * 0.012);
    if (DOUBLE_INLAYS.includes(fret)) {
      [0.3, 0.7].forEach(at => {
        ctx.beginPath();
        ctx.arc(x, neckTop + neckHeight * at, radius, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      ctx.beginPath();
      ctx.arc(x, neckTop + neckHeight / 2, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Fret wires, with the nut drawn heavier.
  for (let fret = 0; fret <= frets; fret += 1) {
    ctx.strokeStyle = fret === 0 ? '#e9e2d0' : '#9c9483';
    ctx.lineWidth = fret === 0 ? Math.max(3, neckWidth * 0.006) : Math.max(1, neckWidth * 0.002);
    ctx.beginPath();
    ctx.moveTo(fretX(fret), neckTop);
    ctx.lineTo(fretX(fret), neckBottom);
    ctx.stroke();
  }

  // Strings, thicker toward the bottom as on the instrument.
  tuning.strings.forEach((_, index) => {
    ctx.strokeStyle = '#cfc8b8';
    ctx.lineWidth = Math.max(1, neckHeight * (0.028 - index * 0.004));
    ctx.beginPath();
    ctx.moveTo(neckLeft - openRoom * 0.2, stringY(index));
    ctx.lineTo(neckRight, stringY(index));
    ctx.stroke();
  });

  // Fret numbers under the inlays.
  ctx.fillStyle = 'rgba(200,212,224,0.75)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `600 ${Math.max(8, pad * 0.62)}px Inter, system-ui, sans-serif`;
  INLAY_FRETS.filter(fret => fret <= frets).forEach(fret => {
    ctx.fillText(String(fret), neckLeft + neckWidth * fretCentre(fret, frets), neckBottom + pad * 0.25);
  });

  // String names at the far left.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  tuning.strings.forEach((open, index) => {
    ctx.fillText(noteName(open, options.accidental), neckLeft - openRoom * 0.95 + pad * 0.5, stringY(index));
  });

  if (options.marks) {
    const radius = Math.min(neckHeight / strings * 0.42, neckWidth / frets * 0.4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    options.marks.forEach(mark => {
      const x = mark.fret === 0
        ? neckLeft - openRoom * 0.42
        : neckLeft + neckWidth * fretCentre(mark.fret, frets);
      const y = stringY(mark.string);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      // The root is filled solid so the eye finds the chord's name in the shape.
      ctx.fillStyle = mark.root ? options.accent : '#e8eef5';
      ctx.fill();
      ctx.fillStyle = '#10151c';
      ctx.font = `800 ${radius * (mark.label.length > 2 ? 0.8 : 1.02)}px Inter, system-ui, sans-serif`;
      ctx.fillText(mark.label, x, y + radius * 0.05);
    });
    ctx.fillStyle = '#ff8a8f';
    ctx.font = `800 ${radius * 1.2}px Inter, system-ui, sans-serif`;
    (options.muted ?? []).forEach(string => {
      ctx.fillText('×', neckLeft - openRoom * 0.42, stringY(string));
    });
    if (options.showReadout && options.title) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 ${readout * 0.8}px Inter, system-ui, sans-serif`;
      ctx.fillText(options.title, pad, readout * 0.55);
    }
    return;
  }

  if (options.midi === null) return;

  // Every place the note lives, with the likely one filled.
  const name = noteName(options.midi, options.accidental);
  const markerRadius = Math.min(neckHeight / strings * 0.42, neckWidth / frets * 0.4);
  positionsFor(options.midi, tuning, frets).forEach(position => {
    const likely = options.position
      && position.string === options.position.string
      && position.fret === options.position.fret;
    const x = position.fret === 0
      ? neckLeft - openRoom * 0.42
      : neckLeft + neckWidth * fretCentre(position.fret, frets);
    const y = stringY(position.string);

    ctx.beginPath();
    ctx.arc(x, y, markerRadius, 0, Math.PI * 2);
    if (likely) {
      ctx.fillStyle = options.accent;
      ctx.shadowColor = options.accent;
      ctx.shadowBlur = markerRadius * 0.9;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#10151c';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${markerRadius * 1.05}px Inter, system-ui, sans-serif`;
      ctx.fillText(name, x, y + markerRadius * 0.05);
    } else {
      ctx.strokeStyle = options.accent;
      ctx.lineWidth = Math.max(1.5, markerRadius * 0.16);
      ctx.globalAlpha = 0.75;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });

  if (options.showReadout) {
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = readout * 0.15;
    ctx.font = `800 ${readout * 0.8}px Inter, system-ui, sans-serif`;
    ctx.fillText(name, pad, readout * 0.55);
    const nameWidth = ctx.measureText(name).width;
    ctx.fillStyle = options.accent;
    ctx.font = `700 ${readout * 0.46}px Inter, system-ui, sans-serif`;
    ctx.fillText(noteDegree(options.midi, options.keyRoot), pad + nameWidth + readout * 0.3, readout * 0.6);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }
}
