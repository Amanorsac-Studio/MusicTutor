/**
 * Hearing the chords in a recording.
 *
 * Different from the live chord detector, which is told exactly which keys are
 * down. Here there is only sound: a whole band, with drums across every
 * frequency and a singer sliding between pitches. Naming individual notes in
 * that is unreliable, and it turns out not to be needed. A chord is a set of
 * pitch classes, and what a chord sounds like is mostly which of the twelve are
 * strong. So the audio is folded down to a chromagram — twelve numbers per
 * moment, one per pitch class, all octaves summed — and each moment is compared
 * against what every chord would look like.
 *
 * Three things make that work on real music rather than only on test tones:
 *
 *  - Beat-synchronous frames. Chords change on beats. Averaging the chroma over
 *    each beat lets the drums and passing notes wash out while the harmony,
 *    which holds still for the whole beat, adds up.
 *  - A bass chroma, taken separately from the low end. C major seven and
 *    E minor share three of their notes; the bass is what tells them apart,
 *    and the bass almost always plays the root.
 *  - Smoothing with a preference for staying put. A chord that lasts one beat
 *    between two longer ones is nearly always a mishearing, so changing chord
 *    has to be earned by evidence rather than happening at every flicker.
 */

import { FFT, hann } from './fft';
import { noteName, type Accidental } from './chords';

/** Analysis window. Long, because telling semitones apart low down needs it. */
export const CHROMA_WINDOW = 8192;
export const CHROMA_HOP = 2048;

/** The band the harmony is read from, and the band the bass is read from. */
export const HARMONY_BAND: [number, number] = [130, 2100];
export const BASS_BAND: [number, number] = [60, 262];

export type ChordQuality = 'maj' | 'min' | '7' | 'maj7' | 'm7';

/** Intervals above the root, in semitones, for each kind of chord listened for. */
export const CHORD_SHAPES: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
};

const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: '', min: 'm', 7: '7', maj7: 'maj7', m7: 'm7',
};

export type ChordSegment = {
  start: number;
  end: number;
  /** Pitch class of the root, or -1 where no chord was heard. */
  root: number;
  quality: ChordQuality | null;
};

/** A chord's name, in the spelling the rest of the app is using. */
export function chordLabel(
  segment: Pick<ChordSegment, 'root' | 'quality'>, accidental: Accidental, transpose = 0,
): string {
  if (segment.root < 0 || !segment.quality) return '—';
  const root = ((segment.root + transpose) % 12 + 12) % 12;
  return noteName(60 + root, accidental) + QUALITY_SUFFIX[segment.quality];
}

/**
 * Which pitch class each FFT bin belongs to, and how much to trust it.
 *
 * A bin dead on a semitone counts fully; one halfway between two counts for
 * almost nothing, since it is as likely to be the neighbour's energy. Built
 * once per sample rate, because it is the same for every frame.
 */
export function binMap(
  sampleRate: number, fftSize: number, band: [number, number], concertPitch = 440,
): Array<{ bin: number; pitchClass: number; weight: number }> {
  const out: Array<{ bin: number; pitchClass: number; weight: number }> = [];
  const binHz = sampleRate / fftSize;
  const from = Math.max(1, Math.ceil(band[0] / binHz));
  const to = Math.min(fftSize / 2 - 1, Math.floor(band[1] / binHz));
  for (let bin = from; bin <= to; bin += 1) {
    const midi = 69 + 12 * Math.log2((bin * binHz) / concertPitch);
    const nearest = Math.round(midi);
    const off = midi - nearest;
    const weight = Math.exp(-0.5 * (off / 0.22) ** 2);
    if (weight < 0.05) continue;
    out.push({ bin, pitchClass: ((nearest % 12) + 12) % 12, weight });
  }
  return out;
}

export type Chromagram = {
  /** One row of twelve per analysis frame, harmony band. */
  harmony: Float32Array[];
  /** The same, for the bass band. */
  bass: Float32Array[];
  /** Loudness of each frame, for telling music from silence. */
  energy: Float32Array;
  /** Seconds between frames. */
  hopSeconds: number;
  /** Seconds covered by one frame's window. */
  windowSeconds: number;
};

/**
 * The frames whose middle falls between two times.
 *
 * A frame is a window of audio, and what it describes is its middle, not its
 * leading edge. Stamping frames by their start made every chord change land a
 * beat early: the last frames of a dying chord reached forward into the loud
 * attack of the next one and were outvoted by it.
 */
export function frameRange(
  chroma: Pick<Chromagram, 'hopSeconds' | 'windowSeconds'>, count: number, start: number, end: number,
): [number, number] {
  const half = chroma.windowSeconds / 2;
  const from = Math.max(0, Math.min(count - 1, Math.ceil((start - half) / chroma.hopSeconds)));
  const to = Math.max(from + 1, Math.min(count, Math.ceil((end - half) / chroma.hopSeconds)));
  return [from, to];
}

/** Fold a recording down to twelve pitch classes per frame. */
export function chromagram(
  samples: Float32Array, sampleRate: number, concertPitch = 440,
  onProgress?: (fraction: number) => void,
): Chromagram {
  const fft = new FFT(CHROMA_WINDOW);
  const window = hann(CHROMA_WINDOW);
  const harmonyMap = binMap(sampleRate, CHROMA_WINDOW, HARMONY_BAND, concertPitch);
  const bassMap = binMap(sampleRate, CHROMA_WINDOW, BASS_BAND, concertPitch);
  const frames = Math.max(0, Math.floor((samples.length - CHROMA_WINDOW) / CHROMA_HOP) + 1);

  const harmony: Float32Array[] = [];
  const bass: Float32Array[] = [];
  const energy = new Float32Array(frames);
  const magnitudes = new Float64Array(CHROMA_WINDOW / 2);

  for (let frame = 0; frame < frames; frame += 1) {
    fft.magnitudes(samples, frame * CHROMA_HOP, window, magnitudes);
    const h = new Float32Array(12);
    const b = new Float32Array(12);
    let total = 0;
    harmonyMap.forEach(({ bin, pitchClass, weight }) => {
      // Square-root compression: loud partials still lead, but one very loud
      // instrument cannot drown the rest of the harmony.
      const value = Math.sqrt(magnitudes[bin]) * weight;
      h[pitchClass] += value;
      total += magnitudes[bin];
    });
    bassMap.forEach(({ bin, pitchClass, weight }) => {
      b[pitchClass] += Math.sqrt(magnitudes[bin]) * weight;
    });
    harmony.push(h);
    bass.push(b);
    energy[frame] = total;
    if (onProgress && frame % 200 === 0) onProgress(frame / Math.max(1, frames));
  }
  onProgress?.(1);
  return {
    harmony, bass, energy,
    hopSeconds: CHROMA_HOP / sampleRate,
    windowSeconds: CHROMA_WINDOW / sampleRate,
  };
}

/** Scale a vector so its largest entry is one. Silence stays silence. */
export function normalise(vector: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < vector.length; i += 1) peak = Math.max(peak, vector[i]);
  const out = new Float32Array(vector.length);
  if (peak > 0) for (let i = 0; i < vector.length; i += 1) out[i] = vector[i] / peak;
  return out;
}

/**
 * What a chord looks like as a chroma vector.
 *
 * Not just its own notes: every note also sounds its overtones, so a C lights
 * up G a little (its third partial) and E faintly (its fifth). Including those
 * makes a real C major look more like the template for C major and less like
 * the template for anything sharing a note with it.
 */
export function chordTemplate(root: number, quality: ChordQuality): Float32Array {
  const template = new Float32Array(12);
  CHORD_SHAPES[quality].forEach(interval => {
    const pc = (root + interval) % 12;
    template[pc] += 1;
    template[(pc + 7) % 12] += 0.22;
    template[(pc + 4) % 12] += 0.08;
  });
  let norm = 0;
  for (let i = 0; i < 12; i += 1) norm += template[i] * template[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < 12; i += 1) template[i] /= norm;
  return template;
}

const QUALITIES = Object.keys(CHORD_SHAPES) as ChordQuality[];

/** Every chord listened for, root by root, built once. */
const VOCABULARY: Array<{ root: number; quality: ChordQuality; template: Float32Array }> = [];
for (let root = 0; root < 12; root += 1) {
  QUALITIES.forEach(quality => {
    VOCABULARY.push({ root, quality, template: chordTemplate(root, quality) });
  });
}

/**
 * How well each chord explains one frame. Index matches VOCABULARY.
 *
 * Similarity to the template, plus credit when the bass is on the root. Four-
 * note chords are held to a slightly higher standard: a seventh is only named
 * when the extra note is really there, since calling every C a Cmaj7 because
 * a melody brushed the B is the commonest way these systems annoy musicians.
 */
export function scoreFrame(harmony: Float32Array, bass: Float32Array): Float32Array {
  const scores = new Float32Array(VOCABULARY.length);
  let norm = 0;
  for (let i = 0; i < 12; i += 1) norm += harmony[i] * harmony[i];
  norm = Math.sqrt(norm);
  if (norm <= 0) return scores;
  const bassNormal = normalise(bass);

  VOCABULARY.forEach((chord, index) => {
    let dot = 0;
    for (let i = 0; i < 12; i += 1) dot += harmony[i] * chord.template[i];
    const similarity = dot / norm;
    const rootInBass = bassNormal[chord.root];
    const complexity = CHORD_SHAPES[chord.quality].length > 3 ? 0.035 : 0;
    scores[index] = similarity + 0.16 * rootInBass - complexity;
  });
  return scores;
}

/**
 * How much a chroma vector stands out from flat, as peak over average.
 *
 * Drums and noise put energy in every pitch class about equally, which comes
 * out near one. A chord concentrates it in three or four, which comes out at
 * three or more. It is how a drum break is told from harmony.
 */
export function peakiness(vector: Float32Array): number {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) {
    peak = Math.max(peak, vector[i]);
    sum += vector[i];
  }
  return sum > 0 ? peak / (sum / vector.length) : 0;
}

/** Below this a slice is treated as unpitched, and says nothing about the chord. */
export const PITCHED_THRESHOLD = 1.7;

/**
 * The single best chord for one chroma picture, or null where there is no
 * harmony to name. For live listening, where there is no song to look ahead in.
 */
export function bestChord(
  harmony: Float32Array, bass: Float32Array,
): { root: number; quality: ChordQuality } | null {
  if (peakiness(harmony) < PITCHED_THRESHOLD) return null;
  const scores = scoreFrame(harmony, bass);
  let best = -1;
  for (let i = 0; i < scores.length; i += 1) {
    if (best < 0 || scores[i] > scores[best]) best = i;
  }
  if (best < 0 || scores[best] <= 0) return null;
  return { root: VOCABULARY[best].root, quality: VOCABULARY[best].quality };
}

/**
 * A chord laid out on the keyboard the way a teacher would show it: the root
 * in the left hand, the chord in close position from around middle C.
 */
export function chordVoicing(root: number, quality: ChordQuality, transpose = 0): number[] {
  const pitch = (((root + transpose) % 12) + 12) % 12;
  // Keep the right hand between G3 and F#4 so every chord sits in one place.
  const base = pitch >= 7 ? 48 + pitch : 60 + pitch;
  return [36 + pitch, ...CHORD_SHAPES[quality].map(interval => base + interval)];
}

/** Average rows of a chromagram between two times. */
function averageBetween(rows: Float32Array[], from: number, to: number): Float32Array {
  const out = new Float32Array(12);
  for (let frame = from; frame < to && frame < rows.length; frame += 1) {
    for (let i = 0; i < 12; i += 1) out[i] += rows[frame][i];
  }
  return out;
}

export type ChordOptions = {
  concertPitch?: number;
  /** How reluctant the result is to change chord. Higher is steadier. */
  stickiness?: number;
  onProgress?: (fraction: number) => void;
};

/**
 * Name the chords of a recording.
 *
 * `beats` are the tracked beat times. One chord is decided per beat, then runs
 * of the same chord are joined. With no beats to go on, half-second slices are
 * used instead, which is cruder but still works.
 */
export function recogniseChords(
  samples: Float32Array, sampleRate: number, beats: number[], options: ChordOptions = {},
): ChordSegment[] {
  const duration = samples.length / sampleRate;
  if (samples.length < CHROMA_WINDOW) return [];
  const chroma = chromagram(samples, sampleRate, options.concertPitch ?? 440, options.onProgress);

  // Slice boundaries: the beats, extended to cover the start and the end.
  let edges = beats.filter(beat => beat > 0 && beat < duration);
  if (edges.length < 4) {
    edges = [];
    for (let t = 0.5; t < duration; t += 0.5) edges.push(t);
  }
  edges = [0, ...edges, duration];

  // A frame far quieter than the track's norm is silence, not a chord.
  const sorted = Array.from(chroma.energy).sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length * 0.6)] || 0;
  const quiet = typical * 0.02;

  const slices: Array<{ start: number; end: number; scores: Float32Array | null }> = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const start = edges[i];
    const end = edges[i + 1];
    if (end - start < 0.05) continue;
    const [from, to] = frameRange(chroma, chroma.energy.length, start, end);
    let level = 0;
    for (let frame = from; frame < to; frame += 1) level += chroma.energy[frame];
    level /= Math.max(1, to - from);
    if (level <= quiet) {
      slices.push({ start, end, scores: null });
      continue;
    }
    const harmony = averageBetween(chroma.harmony, from, to);
    // A drum break or a noisy gap gives no evidence either way, so the chord
    // before it simply carries on rather than being replaced by a guess.
    if (peakiness(harmony) < PITCHED_THRESHOLD) {
      slices.push({ start, end, scores: new Float32Array(VOCABULARY.length) });
      continue;
    }
    slices.push({
      start, end,
      scores: scoreFrame(harmony, averageBetween(chroma.bass, from, to)),
    });
  }
  if (!slices.length) return [];

  /*
   * Choose the best path through the slices, where changing chord costs
   * something. This is what removes one-beat flickers: a brief better match
   * does not win unless it beats the cost of leaving and coming back.
   */
  const stickiness = options.stickiness ?? 0.085;
  const states = VOCABULARY.length;
  let best = new Float32Array(states);
  const back: Int32Array[] = [];

  slices.forEach((slice, index) => {
    const next = new Float32Array(states);
    const from = new Int32Array(states);
    let leader = 0;
    for (let s = 1; s < states; s += 1) if (best[s] > best[leader]) leader = s;
    for (let s = 0; s < states; s += 1) {
      const stay = best[s];
      const move = best[leader] - stickiness;
      const arrive = index === 0 ? 0 : Math.max(stay, move);
      from[s] = index === 0 || stay >= move ? s : leader;
      // A silent slice gives no evidence, so the path simply carries through it.
      next[s] = arrive + (slice.scores ? slice.scores[s] : 0);
    }
    best = next;
    back.push(from);
  });

  let state = 0;
  for (let s = 1; s < states; s += 1) if (best[s] > best[state]) state = s;
  const path = new Int32Array(slices.length);
  for (let index = slices.length - 1; index >= 0; index -= 1) {
    path[index] = state;
    state = back[index][state];
  }

  // Join runs of the same chord, leaving silence as silence.
  const segments: ChordSegment[] = [];
  slices.forEach((slice, index) => {
    const chord = slice.scores ? VOCABULARY[path[index]] : null;
    const root = chord ? chord.root : -1;
    const quality = chord ? chord.quality : null;
    const last = segments[segments.length - 1];
    if (last && last.root === root && last.quality === quality) last.end = slice.end;
    else segments.push({ start: slice.start, end: slice.end, root, quality });
  });
  return segments;
}

/** The chord sounding at a moment, or null between chords. */
export function chordAt(segments: ChordSegment[], time: number): ChordSegment | null {
  // Binary search: this is asked for on every animation frame.
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (time < segments[mid].start) high = mid - 1;
    else if (time >= segments[mid].end) low = mid + 1;
    else return segments[mid];
  }
  return null;
}
