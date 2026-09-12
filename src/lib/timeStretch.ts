/**
 * Time stretching that keeps the pitch, and pitch shifting that keeps the time.
 *
 * The old player chopped the track into fixed grains and overlapped them at a
 * fixed rate. That is the textbook naive approach and it has a textbook flaw:
 * consecutive grains land at arbitrary phase relative to each other, so where
 * they overlap they partly cancel. The result wobbles, and on sustained notes
 * it sounds like chorus.
 *
 * This is WSOLA — waveform similarity overlap-add. The difference is one idea:
 * before taking each grain, look a little either side of where it ought to come
 * from and take it from wherever it best continues the waveform already
 * written. The grains then line up in phase and add cleanly.
 *
 * Everything here is plain arithmetic on Float32Arrays, so it can run in a
 * worker and be tested without an audio context.
 */

/** A Hann window. At half-frame overlap two of these sum to exactly one. */
export function hannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length);
  }
  return window;
}

/**
 * How alike two stretches of waveform are, from -1 to 1.
 *
 * Normalised, so a quiet passage is compared on its shape rather than losing to
 * a loud one purely for being louder.
 */
export function similarity(
  a: Float32Array, aStart: number,
  b: Float32Array, bStart: number,
  length: number,
  step = 1,
): number {
  let dot = 0;
  let energyA = 0;
  let energyB = 0;
  for (let i = 0; i < length; i += step) {
    const x = a[aStart + i] ?? 0;
    const y = b[bStart + i] ?? 0;
    dot += x * y;
    energyA += x * x;
    energyB += y * y;
  }
  const scale = Math.sqrt(energyA * energyB);
  return scale > 1e-12 ? dot / scale : 0;
}

/**
 * Find where to actually take the next grain from.
 *
 * `ideal` is where the timeline says it should come from; the answer is allowed
 * to be up to `tolerance` samples either side of that, chosen to best match
 * `target` — the waveform that would naturally have followed what was last
 * written. Searching coarsely first and then refining keeps this fast enough to
 * run over a whole track: a straight search would be twenty times the work for
 * the same answer.
 */
export function bestOffset(
  source: Float32Array,
  ideal: number,
  target: Float32Array,
  tolerance: number,
  windowLength: number,
): number {
  if (tolerance <= 0) return 0;
  const coarseStep = 4;

  let bestCoarse = 0;
  let bestScore = -Infinity;
  for (let delta = -tolerance; delta <= tolerance; delta += coarseStep) {
    const at = ideal + delta;
    if (at < 0 || at + windowLength >= source.length) continue;
    const score = similarity(source, at, target, 0, windowLength, coarseStep);
    if (score > bestScore) {
      bestScore = score;
      bestCoarse = delta;
    }
  }

  // Then the neighbourhood of the winner, sample by sample.
  let best = bestCoarse;
  bestScore = -Infinity;
  for (let delta = bestCoarse - coarseStep; delta <= bestCoarse + coarseStep; delta += 1) {
    if (Math.abs(delta) > tolerance) continue;
    const at = ideal + delta;
    if (at < 0 || at + windowLength >= source.length) continue;
    const score = similarity(source, at, target, 0, windowLength);
    if (score > bestScore) {
      bestScore = score;
      best = delta;
    }
  }
  return best;
}

export type StretchOptions = {
  /** Grain length in samples. About 45 ms at 44.1 kHz suits music. */
  frame?: number;
  /** How far either side of the ideal position the search may look. */
  tolerance?: number;
  /** Called with 0..1 as the render proceeds, for a progress bar. */
  onProgress?: (fraction: number) => void;
};

/** Output length for a given stretch factor. */
export const stretchedLength = (inputLength: number, factor: number): number =>
  Math.max(1, Math.round(inputLength * factor));

/**
 * Stretch one channel by `factor`, keeping its pitch.
 *
 * A factor above one makes the result longer — playing at 70% speed is a factor
 * of 1/0.7. A factor of exactly one returns the input untouched, because
 * resynthesising audio that does not need it can only make it worse.
 */
export function stretchChannel(
  input: Float32Array, factor: number, options: StretchOptions = {},
): Float32Array {
  if (!Number.isFinite(factor) || factor <= 0) return input.slice();
  if (Math.abs(factor - 1) < 1e-6) return input.slice();

  const frame = Math.max(64, options.frame ?? 2048);
  const half = Math.floor(frame / 2);
  const tolerance = Math.max(0, options.tolerance ?? Math.floor(half / 2));
  // How much the correlation looks at. Less than the whole grain, because the
  // start of a grain is what has to line up; the tail is windowed away anyway.
  const matchLength = Math.min(half, 512);

  const outputLength = stretchedLength(input.length, factor);
  const output = new Float32Array(outputLength + frame);
  const window = hannWindow(frame);

  // The synthesis hop is fixed; the analysis hop is what carries the stretch.
  const synthesisHop = half;
  const analysisHop = synthesisHop / factor;

  // The waveform that would naturally have followed the grain just written.
  const target = new Float32Array(matchLength);
  let previousAnalysis = 0;
  let ideal = 0;
  let writeAt = 0;
  let grains = 0;

  while (writeAt < outputLength) {
    let take = Math.round(ideal);
    if (grains > 0) {
      // What should come next if the source simply carried on.
      const naturalStart = previousAnalysis + synthesisHop;
      for (let i = 0; i < matchLength; i += 1) target[i] = input[naturalStart + i] ?? 0;
      take = Math.round(ideal) + bestOffset(input, Math.round(ideal), target, tolerance, matchLength);
    }
    take = Math.max(0, Math.min(input.length - 1, take));

    const available = Math.min(frame, input.length - take);
    for (let i = 0; i < available; i += 1) {
      output[writeAt + i] += input[take + i] * window[i];
    }

    previousAnalysis = take;
    ideal += analysisHop;
    writeAt += synthesisHop;
    grains += 1;

    if (options.onProgress && grains % 64 === 0) {
      options.onProgress(Math.min(1, writeAt / outputLength));
    }
    if (ideal >= input.length) break;
  }

  options.onProgress?.(1);
  // A copy rather than a view: the result is handed between threads, and a
  // view would carry the whole oversized backing buffer along with it.
  return output.slice(0, outputLength);
}

/** Stretch every channel of a track. */
export function stretchChannels(
  channels: Float32Array[], factor: number, options: StretchOptions = {},
): Float32Array[] {
  return channels.map((channel, index) => stretchChannel(channel, factor, {
    ...options,
    // Only the first channel reports, or the bar would jump back for each one.
    onProgress: index === 0 ? options.onProgress : undefined,
  }));
}

/**
 * How to play a track at a given speed and transposition.
 *
 * Both are wanted at once — a backing track slowed to 70% and dropped a tone to
 * suit a singer — and doing them in two passes would resynthesise twice. One
 * stretch plus one playback rate covers both cases:
 *
 *   rate   moves pitch and time together, so it sets the transposition
 *   factor undoes the time change the rate caused, and applies the speed
 */
export function renderPlan(speed: number, semitones: number): { factor: number; rate: number } {
  const safeSpeed = Math.max(0.1, Math.min(4, speed || 1));
  const rate = Math.pow(2, (semitones || 0) / 12);
  return { factor: rate / safeSpeed, rate };
}

export type Peak = { min: number; max: number };

/**
 * Reduce a channel to a small number of min/max pairs for drawing.
 *
 * A waveform view is a few hundred pixels wide against millions of samples, so
 * what matters per pixel is the extremes: drawing every sample would be slow
 * and would miss the transients that make a waveform readable.
 */
export function computePeaks(channel: Float32Array, buckets: number): Peak[] {
  const count = Math.max(1, Math.floor(buckets));
  const peaks: Peak[] = new Array(count);
  const per = channel.length / count;

  for (let bucket = 0; bucket < count; bucket += 1) {
    const from = Math.floor(bucket * per);
    const to = Math.min(channel.length, Math.floor((bucket + 1) * per));
    let min = 0;
    let max = 0;
    for (let i = from; i < to; i += 1) {
      const value = channel[i];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    peaks[bucket] = { min, max };
  }
  return peaks;
}

/** Peaks of the loudest channel, so a quiet side does not flatten the picture. */
export function peaksFor(channels: Float32Array[], buckets: number): Peak[] {
  if (!channels.length) return [];
  const all = channels.map(channel => computePeaks(channel, buckets));
  return all[0].map((_, index) => {
    let min = 0;
    let max = 0;
    all.forEach(peaks => {
      if (peaks[index].min < min) min = peaks[index].min;
      if (peaks[index].max > max) max = peaks[index].max;
    });
    return { min, max };
  });
}
