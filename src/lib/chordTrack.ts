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
/** Window for the bass's own, slowed-down transform. A third of a second. */
const BASS_WINDOW = 4096;

/** The band the harmony is read from, and the band the bass is read from. */
export const HARMONY_BAND: [number, number] = [130, 2100];
export const BASS_BAND: [number, number] = [60, 262];

export type ChordQuality = 'maj' | 'min' | '7' | 'maj7' | 'm7' | 'sus' | '2' | 'dim';

/** Intervals above the root, in semitones, for each kind of chord listened for. */
export const CHORD_SHAPES: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  // The three below are what a working chord chart is full of and a list of
  // plain triads cannot say: the held fourth, the added second, the diminished.
  sus: [0, 5, 7],
  2: [0, 2, 4, 7],
  dim: [0, 3, 6],
};

const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: '', min: 'm', 7: '7', maj7: 'maj7', m7: 'm7', sus: 'sus', 2: '2', dim: 'dim',
};

/**
 * What each kind of chord has to overcome to be named.
 *
 * A plain triad is the default. Anything richer is only named when its extra
 * note is really there, since calling every C a C2 because the tune brushed a
 * D is the commonest way these systems annoy musicians.
 */
const RELUCTANCE: Record<ChordQuality, number> = {
  maj: 0, min: 0, 7: 0.035, maj7: 0.035, m7: 0.035, sus: 0.07, 2: 0.16, dim: 0.06,
};

export type ChordSegment = {
  start: number;
  end: number;
  /** Pitch class of the root, or -1 where no chord was heard. */
  root: number;
  quality: ChordQuality | null;
  /**
   * The bass note's pitch class, when the bass is holding a chord note other
   * than the root: the F in D♭/F. Absent when the bass is on the root.
   */
  bass?: number;
};

/** A chord's name, in the spelling the rest of the app is using. */
export function chordLabel(
  segment: Pick<ChordSegment, 'root' | 'quality' | 'bass'>, accidental: Accidental, transpose = 0,
): string {
  if (segment.root < 0 || !segment.quality) return '—';
  const shift = (pc: number) => ((pc + transpose) % 12 + 12) % 12;
  const name = noteName(60 + shift(segment.root), accidental) + QUALITY_SUFFIX[segment.quality];
  return segment.bass === undefined || segment.bass === segment.root
    ? name
    : `${name}/${noteName(60 + shift(segment.bass), accidental)}`;
}

/**
 * Whether a key is written in flats.
 *
 * A song in D♭ has a G♭ chord in it, not an F♯. Spelling follows the key, as
 * every printed chart does; one fixed choice for the whole app would make half
 * of all songs read wrongly.
 */
export function keyPrefersFlats(key: { root: number; mode: 'major' | 'minor' }): boolean {
  const major = key.mode === 'minor' ? (key.root + 3) % 12 : key.root;
  // F, B♭, E♭, A♭, D♭, G♭ and their relative minors.
  return [5, 10, 3, 8, 1, 6].includes(major);
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
  const frames = Math.max(0, Math.floor((samples.length - CHROMA_WINDOW) / CHROMA_HOP) + 1);

  const harmony: Float32Array[] = [];
  const bass: Float32Array[] = [];
  const energy = new Float32Array(frames);
  const magnitudes = new Float64Array(CHROMA_WINDOW / 2);

  /*
   * The bass gets a second, finer listen. At the bottom of a bass guitar two
   * neighbouring notes are under five hertz apart, which is about one bin of
   * the transform above: it cannot tell an E from an F down there, and the
   * root of the chord is exactly what is down there. Slowing the signal down
   * four times and transforming that gives four times the resolution where it
   * is needed, for almost no extra work.
   */
  const slow = Math.max(1, Math.round(sampleRate / 11025));
  const lowRate = sampleRate / slow;
  const low = new Float32Array(Math.floor(samples.length / slow));
  for (let i = 0; i < low.length; i += 1) {
    let sum = 0;
    for (let k = 0; k < slow; k += 1) sum += samples[i * slow + k];
    low[i] = sum / slow;
  }
  const lowFft = new FFT(BASS_WINDOW);
  const lowWindow = hann(BASS_WINDOW);
  const lowMap = binMap(lowRate, BASS_WINDOW, BASS_BAND, concertPitch);
  const lowMagnitudes = new Float64Array(BASS_WINDOW / 2);

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
    // Centred on the same moment as the frame above, so the two line up.
    const centre = frame * CHROMA_HOP + CHROMA_WINDOW / 2;
    lowFft.magnitudes(low, Math.round(centre / slow) - BASS_WINDOW / 2, lowWindow, lowMagnitudes);
    lowMap.forEach(({ bin, pitchClass, weight }) => {
      b[pitchClass] += Math.sqrt(lowMagnitudes[bin]) * weight;
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
export function scoreFrame(harmony: Float32Array, bass: Float32Array, bassWeight = 0.16): Float32Array {
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
    // Mostly the root, but bass players walk: a fifth or a third underneath is
    // still this chord, and giving it no credit hands the beat to whichever
    // chord happens to be rooted on the passing note.
    const shape = CHORD_SHAPES[chord.quality];
    const rootInBass = bassNormal[chord.root]
      + 0.45 * bassNormal[(chord.root + shape[2]) % 12]
      + 0.3 * bassNormal[(chord.root + shape[1]) % 12];
    scores[index] = similarity + bassWeight * rootInBass - RELUCTANCE[chord.quality];
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
  harmony: Float32Array, bass: Float32Array, bassWeight = 0.16,
): { root: number; quality: ChordQuality } | null {
  if (peakiness(harmony) < PITCHED_THRESHOLD) return null;
  const scores = scoreFrame(harmony, bass, bassWeight);
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

/**
 * Move each chord change to where the music actually changes.
 *
 * Chords are decided a beat at a time, so every change first lands on a beat.
 * But the tracked beat can sit a little off the playing, and players push and
 * drag changes. A change drawn late is the worst kind of wrong for someone
 * playing along: the screen tells them the new chord after they needed it. So
 * around each boundary, every possible split is tried, and the one where the
 * old chord best explains what is before it and the new chord what is after
 * wins.
 */
function refineBoundaries(
  segments: ChordSegment[], chroma: Chromagram, bassRows: Float32Array[], bassWeight: number,
): void {
  const frames = chroma.harmony.length;
  const indexOf = (segment: ChordSegment) =>
    VOCABULARY.findIndex(chord => chord.root === segment.root && chord.quality === segment.quality);
  const centre = (frame: number) => frame * chroma.hopSeconds + chroma.windowSeconds / 2;

  for (let i = 0; i + 1 < segments.length; i += 1) {
    const before = segments[i];
    const after = segments[i + 1];
    const a = indexOf(before);
    const b = indexOf(after);
    if (a < 0 || b < 0) continue;
    // Never search past the middle of either chord, or short chords vanish.
    const reach = Math.min(0.4, (before.end - before.start) / 2, (after.end - after.start) / 2);
    const lo = Math.max(0, Math.floor((before.end - reach - chroma.windowSeconds / 2) / chroma.hopSeconds));
    const hi = Math.min(frames - 1, Math.ceil((before.end + reach - chroma.windowSeconds / 2) / chroma.hopSeconds));
    if (hi - lo < 2) continue;

    // How much better the new chord explains each frame than the old one.
    const gain: number[] = [];
    for (let frame = lo; frame <= hi; frame += 1) {
      const scores = scoreFrame(chroma.harmony[frame], bassRows[frame] ?? chroma.bass[frame], bassWeight);
      gain.push(scores[b] - scores[a]);
    }
    // Split before frame lo + k: old chord owns [lo, lo+k), new owns the rest.
    let total = 0;
    for (const value of gain) total += value;
    let bestSplit = 0;
    let bestScore = total;
    let running = total;
    // A split has to earn its distance from the beat. Where the two chords
    // share most of their notes the evidence is nearly flat, and without this
    // the boundary slides to the edge of the search for no musical reason.
    const away = (k: number) => Math.abs(centre(lo + k) - before.end) * 0.6;
    bestScore = total - away(0);
    for (let k = 1; k <= gain.length; k += 1) {
      running -= gain[k - 1];
      const value = running - away(k);
      if (value > bestScore + 1e-6) { bestScore = value; bestSplit = k; }
    }
    // The window reaches forward of its centre, so the attack of the new chord
    // is heard by frames stamped a little before it. Lean early, never late.
    const moved = centre(lo + bestSplit) - chroma.hopSeconds;
    const time = Math.max(before.start + 0.05, Math.min(after.end - 0.05, moved));
    before.end = time;
    after.start = time;
  }
}

/**
 * The key a run of chords is in, judged by how long each chord lasts.
 *
 * Each of the twenty-four keys is scored by how much of the song its own
 * chords cover, with the home chord counting extra, and extra again where the
 * song ends on it. Needed for solfa and numbers, which mean nothing without a
 * key to count from.
 */
export function estimateKey(segments: ChordSegment[]): { root: number; mode: 'major' | 'minor' } {
  const weight = new Float32Array(24); // 0..11 major triads, 12..23 minor
  segments.forEach(segment => {
    if (segment.root < 0 || !segment.quality) return;
    const minor = segment.quality === 'min' || segment.quality === 'm7';
    weight[(minor ? 12 : 0) + segment.root] += segment.end - segment.start;
  });
  const lastChord = [...segments].reverse().find(segment => segment.root >= 0 && segment.quality);
  const at = (root: number, minor: boolean) => weight[(minor ? 12 : 0) + (((root % 12) + 12) % 12)];

  let best = { root: 0, mode: 'major' as 'major' | 'minor' };
  let bestScore = -1;
  for (let root = 0; root < 12; root += 1) {
    // I ii iii IV V vi, and the same set seen from the relative minor.
    const family = at(root, false) + at(root + 2, true) + at(root + 4, true)
      + at(root + 5, false) + at(root + 7, false) + at(root + 9, true);
    const endsMajor = lastChord && lastChord.root === root && at(root, false) > 0
      && (lastChord.quality === 'maj' || lastChord.quality === 'maj7' || lastChord.quality === '7');
    const minorRoot = (root + 9) % 12;
    const endsMinor = lastChord && lastChord.root === minorRoot
      && (lastChord.quality === 'min' || lastChord.quality === 'm7');
    const major = family + at(root, false) * 1.0 + (endsMajor ? family * 0.15 : 0);
    const minor = family + at(minorRoot, true) * 1.0 + (endsMinor ? family * 0.15 : 0)
      // The major dominant is what makes a minor key sound like one.
      + at(minorRoot + 7, false) * 0.5;
    if (major > bestScore) { bestScore = major; best = { root, mode: 'major' }; }
    if (minor > bestScore) { bestScore = minor; best = { root: minorRoot, mode: 'minor' }; }
  }
  return best;
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
  /**
   * The bass on its own, when the song has been separated. `samples` should
   * then be the chord instruments without it. A band decides a chord between
   * the bass player and the keys, and hearing each cleanly, rather than both
   * through the drums and the singer, is the largest single gain there is.
   */
  bassSamples?: Float32Array;
  /** Lean toward chords in the song's key on a second pass. On unless false. */
  keyPrior?: boolean;
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
  const separated = options.bassSamples && options.bassSamples.length >= CHROMA_WINDOW
    ? chromagram(options.bassSamples, sampleRate, options.concertPitch ?? 440)
    : null;
  const bassRows = separated ? separated.bass : chroma.bass;
  // A clean bass line names the root more reliably than a band's low end, but
  // only a little more weight is safe: bass players walk, and a passing fifth
  // trusted too far renames the chord for a beat.
  const bassWeight = separated ? 0.2 : 0.16;

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
      scores: scoreFrame(harmony, averageBetween(bassRows, from, to), bassWeight),
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
  const bestPath = (favour: Float32Array | null): Int32Array => {
    let best = new Float32Array(states);
    const back: Int32Array[] = [];
    slices.forEach((slice, index) => {
      const next = new Float32Array(states);
      const fromState = new Int32Array(states);
      let leader = 0;
      for (let s = 1; s < states; s += 1) if (best[s] > best[leader]) leader = s;
      for (let s = 0; s < states; s += 1) {
        const stay = best[s];
        const move = best[leader] - stickiness;
        const arrive = index === 0 ? 0 : Math.max(stay, move);
        fromState[s] = index === 0 || stay >= move ? s : leader;
        // A silent slice gives no evidence, so the path simply carries through it.
        next[s] = arrive + (slice.scores ? slice.scores[s] + (favour ? favour[s] : 0) : 0);
      }
      best = next;
      back.push(fromState);
    });
    let state = 0;
    for (let s = 1; s < states; s += 1) if (best[s] > best[state]) state = s;
    const path = new Int32Array(slices.length);
    for (let index = slices.length - 1; index >= 0; index -= 1) {
      path[index] = state;
      state = back[index][state];
    }
    return path;
  };

  // Join runs of the same chord, leaving silence as silence.
  const join = (path: Int32Array): ChordSegment[] => {
    const joined: ChordSegment[] = [];
    slices.forEach((slice, index) => {
      const chord = slice.scores ? VOCABULARY[path[index]] : null;
      const root = chord ? chord.root : -1;
      const quality = chord ? chord.quality : null;
      const last = joined[joined.length - 1];
      if (last && last.root === root && last.quality === quality) last.end = slice.end;
      else joined.push({ start: slice.start, end: slice.end, root, quality });
    });
    return joined;
  };

  /*
   * Twice through. The first pass finds the key; the second leans, gently,
   * toward chords that belong in it. A listener does the same: in a song in G,
   * an ambiguous moment is far more likely to be Em than E♭. The lean is small
   * enough that a chord from outside the key still wins when it is really there.
   */
  let segments = join(bestPath(null));
  if (options.keyPrior !== false && segments.some(segment => segment.root >= 0)) {
    const key = estimateKey(segments);
    const home = key.mode === 'minor' ? (key.root + 3) % 12 : key.root;
    const majors = [0, 5, 7].map(step => (home + step) % 12);
    const minors = [2, 4, 9].map(step => (home + step) % 12);
    // The major chord on the fifth of a minor key is what makes it sound minor.
    if (key.mode === 'minor') majors.push((key.root + 7) % 12);
    const favour = new Float32Array(states);
    VOCABULARY.forEach((chord, index) => {
      const minorKind = chord.quality === 'min' || chord.quality === 'm7';
      const majorKind = !minorKind && chord.quality !== 'dim';
      if ((majorKind && majors.includes(chord.root)) || (minorKind && minors.includes(chord.root))) {
        favour[index] = 0.03;
      }
    });
    segments = join(bestPath(favour));
  }

  // Where the bass sits on a chord note that is not the root, say so: D♭/F.
  segments.forEach(segment => {
    if (segment.root < 0 || !segment.quality) return;
    const [first, last] = frameRange(chroma, chroma.energy.length, segment.start, segment.end);
    const low = averageBetween(bassRows, first, last);
    let top = 0;
    for (let pc = 1; pc < 12; pc += 1) if (low[pc] > low[top]) top = pc;
    const interval = (top - segment.root + 12) % 12;
    const inChord = CHORD_SHAPES[segment.quality].includes(interval);
    // Clearly the bass, not a near tie with the root underneath it.
    if (interval !== 0 && inChord && low[top] > low[segment.root] * 1.7) segment.bass = top;
  });
  refineBoundaries(segments, chroma, bassRows, bassWeight);
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
