/**
 * Clef glyphs, drawn as filled shapes.
 *
 * A clef is calligraphy: the stroke is thin where the pen turned and thick
 * where it pulled, and that thickness change is most of what makes the shape
 * recognisable. A constant-width stroke reads as a squiggle instead.
 *
 * So each clef is defined as a centreline with a width at every point — the
 * path a broad nib would have taken — and the outline is built by offsetting
 * that line to both sides and filling the result. The Unicode clef characters
 * would be easier, but they render as empty boxes on any machine without a
 * music font, which cannot be assumed.
 *
 * Coordinates are in staff spaces, with the origin on the line the clef names:
 * the G line for the treble, the F line for the bass. Positive y is downwards,
 * matching the canvas.
 */

/** One point along a pen stroke: where it is, and how broad the nib is there. */
export type SpinePoint = { x: number; y: number; w: number };

/**
 * Smooth a sparse centreline into a dense one.
 *
 * Catmull-Rom passes exactly through every point it is given, which means the
 * spine below can be written as the handful of places the stroke actually
 * turns, rather than as hundreds of coordinates.
 */
export function smoothSpine(points: SpinePoint[], perSegment = 12): SpinePoint[] {
  if (points.length < 2) return [...points];
  const out: SpinePoint[] = [];
  const at = (index: number) => points[Math.max(0, Math.min(points.length - 1, index))];

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let step = 0; step < perSegment; step += 1) {
      const t = step / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      // The standard Catmull-Rom basis, applied to each channel including width.
      const blend = (a: number, b: number, c: number, d: number) =>
        0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({
        x: blend(p0.x, p1.x, p2.x, p3.x),
        y: blend(p0.y, p1.y, p2.y, p3.y),
        w: Math.max(0, blend(p0.w, p1.w, p2.w, p3.w)),
      });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Turn a centreline into a closed outline.
 *
 * Each point is pushed out by half its width along the normal to the stroke,
 * gathering one side on the way out and the other on the way back, which
 * leaves a single closed loop ready to fill.
 */
export function ribbonOutline(spine: SpinePoint[]): Array<[number, number]> {
  if (spine.length < 2) return [];
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];

  for (let i = 0; i < spine.length; i += 1) {
    const previous = spine[Math.max(0, i - 1)];
    const next = spine[Math.min(spine.length - 1, i + 1)];
    let dx = next.x - previous.x;
    let dy = next.y - previous.y;
    const length = Math.hypot(dx, dy);
    // A repeated point has no direction of its own; borrow the one before it.
    if (length < 1e-9) {
      dx = 0;
      dy = 1;
    } else {
      dx /= length;
      dy /= length;
    }
    const half = spine[i].w / 2;
    // The normal is the direction turned a quarter turn.
    const nx = -dy * half;
    const ny = dx * half;
    left.push([spine[i].x + nx, spine[i].y + ny]);
    right.push([spine[i].x - nx, spine[i].y - ny]);
  }

  return [...left, ...right.reverse()];
}

/**
 * The treble clef.
 *
 * The pen starts at the thin tail below the staff, sweeps up through the
 * crossing, opens into the big loop above the staff, comes back down through
 * the crossing and spirals inwards to finish with its eye centred on the G
 * line — which is exactly what tells the reader that line is G.
 */
export const TREBLE_SPINE: SpinePoint[] = [
  { x: -1.02, y: 1.86, w: 0.056 },
  { x: -0.20, y: 1.97, w: 0.157 },
  { x: 0.71, y: 1.72, w: 0.224 },
  { x: 0.88, y: 1.59, w: 0.246 },
  { x: 0.48, y: 1.04, w: 0.269 },
  { x: -0.37, y: 0.35, w: 0.325 },
  { x: -1.05, y: -0.50, w: 0.358 },
  { x: -1.19, y: -1.52, w: 0.336 },
  { x: -0.71, y: -2.50, w: 0.280 },
  { x: 0.14, y: -3.22, w: 0.224 },
  { x: 0.71, y: -3.74, w: 0.146 },
  { x: 0.23, y: -4.04, w: 0.090 },
  { x: -0.68, y: -3.70, w: 0.134 },
  { x: -1.28, y: -2.96, w: 0.202 },
  { x: -1.36, y: -1.98, w: 0.269 },
  { x: -0.99, y: -0.94, w: 0.325 },
  { x: -0.34, y: 0.01, w: 0.370 },
  { x: 0.62, y: 0.63, w: 0.370 },
  { x: 1.28, y: 1.12, w: 0.302 },
  { x: 1.11, y: 1.55, w: 0.213 },
  { x: 0.17, y: 1.70, w: 0.168 },
  { x: -0.68, y: 1.42, w: 0.146 },
  { x: -0.88, y: 0.93, w: 0.134 },
  { x: -0.34, y: 0.56, w: 0.123 },
  { x: 0.43, y: 0.63, w: 0.101 },
  { x: 0.77, y: 0.90, w: 0.067 },
];

/**
 * The eye of the treble clef: the small closed circle centred on the G line.
 *
 * On a real glyph the spiral closes into a solid disc here, and drawing it as
 * a disc rather than as more spiral is both simpler and truer to the shape.
 */
export const TREBLE_EYE = { x: -0.06, y: 0.04, r: 0.36 };

/** And the dot at the bottom of the tail, which the spiral ends in. */
export const TREBLE_DOT = { x: -0.66, y: 1.78, r: 0.29 };

/**
 * The bass clef.
 *
 * A thick comma: the pen starts small at the upper right, runs anticlockwise
 * over the top of a round head, then pulls away in a long thinning tail down
 * and to the left. The head is centred on the F line, and the two dots sit
 * either side of it, which is how a reader finds F.
 */
export const BASS_SPINE: SpinePoint[] = [
  { x: 0.56, y: -1.02, w: 0.076 },
  { x: -0.05, y: -1.22, w: 0.184 },
  { x: -0.76, y: -1.00, w: 0.302 },
  { x: -1.07, y: -0.48, w: 0.378 },
  { x: -0.93, y: 0.06, w: 0.410 },
  { x: -0.32, y: 0.35, w: 0.389 },
  { x: 0.39, y: 0.24, w: 0.410 },
  { x: 0.93, y: -0.18, w: 0.475 },
  { x: 1.27, y: 0.40, w: 0.497 },
  { x: 1.27, y: 0.99, w: 0.410 },
  { x: 0.73, y: 1.54, w: 0.281 },
  { x: -0.12, y: 1.94, w: 0.173 },
  { x: -0.86, y: 2.28, w: 0.076 },
  { x: -1.18, y: 2.46, w: 0.032 },
];

/** The solid head of the bass clef, sitting on the F line. */
export const BASS_HEAD = { x: -0.14, y: -0.08, r: 0.45 };

/** Its two dots, one in the space above the F line and one below. */
export const BASS_DOTS = [
  { x: 1.56, y: -0.5, r: 0.21 },
  { x: 1.56, y: 0.5, r: 0.21 },
];

/**
 * Every filled piece of a clef, in staff spaces.
 *
 * Returning the pieces rather than drawing them keeps the shapes testable and
 * lets the caller decide about colour, scale and position.
 */
export function clefShapes(clef: 'treble' | 'bass'): {
  ribbon: Array<[number, number]>;
  discs: Array<{ x: number; y: number; r: number }>;
} {
  if (clef === 'treble') {
    return {
      ribbon: ribbonOutline(smoothSpine(TREBLE_SPINE)),
      discs: [TREBLE_EYE, TREBLE_DOT],
    };
  }
  return {
    ribbon: ribbonOutline(smoothSpine(BASS_SPINE)),
    discs: [BASS_HEAD, ...BASS_DOTS],
  };
}

/** Vertical extent of a clef, for checking it fits the space allowed. */
export function clefBounds(clef: 'treble' | 'bass'): { top: number; bottom: number } {
  const { ribbon, discs } = clefShapes(clef);
  let top = Infinity;
  let bottom = -Infinity;
  ribbon.forEach(([, y]) => {
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  });
  discs.forEach(disc => {
    top = Math.min(top, disc.y - disc.r);
    bottom = Math.max(bottom, disc.y + disc.r);
  });
  return { top, bottom };
}
