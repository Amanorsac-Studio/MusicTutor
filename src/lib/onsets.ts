/**
 * Finding the moments where notes begin.
 *
 * Everything about tempo rests on this. The previous detector measured how loud
 * the track was, frame by frame, and called a rise an onset. That fails on most
 * real music: a melody played over a sustained accompaniment barely changes the
 * total loudness, so a piano piece produced almost no signal and the tempo was a
 * guess. Worse, it was dominated by bass, because bass carries most of the
 * energy in a mix.
 *
 * This looks at the spectrum instead, and measures energy appearing in each
 * frequency band separately. A new note shows up as a rise in its own band even
 * when the overall level is flat. Three things make that work in practice:
 *
 *  - Log compression. The ear hears ratios, not differences, so a quiet note
 *    over a loud background matters as much as a loud one over silence. Taking
 *    the log before differencing is the single largest improvement here.
 *  - Log-spaced bands. Musical pitch is logarithmic, so bands that follow it
 *    give a bass drum and a hi-hat comparable weight instead of letting the low
 *    end dominate by sheer energy.
 *  - A maximum filter across frequency, from the SuperFlux method. Vibrato and
 *    string bends slide energy between neighbouring bins, which a plain
 *    difference reads as a stream of false onsets; comparing against the local
 *    maximum of the previous frame ignores that movement while still catching a
 *    genuine attack.
 */

import { FFT, hann, nextPowerOfTwo } from './fft';

/** Hop between analysis frames, in samples. ~5.8 ms at 44.1 kHz. */
export const ONSET_HOP = 256;

/** Analysis window. Long enough to resolve bass, short enough to stay sharp. */
export const ONSET_WINDOW = 2048;

/**
 * When a frame's onset actually happened, as samples past the frame's start.
 *
 * A frame is not an instant: it compares a window of audio against the one
 * before it, and the flux peaks on the first frame whose window holds the
 * attack while the previous one did not. That puts the attack near the far end
 * of the window rather than at its start or its middle — a window minus a hop.
 *
 * Measured against a synthetic attack at a known time, the peak frame began
 * 1860 samples before it, against the 1792 this predicts: within a millisecond
 * and a half. Ignoring it entirely puts every beat forty milliseconds early,
 * which is plainly audible when the click plays along with the track.
 */
export const FRAME_LAG = ONSET_WINDOW - ONSET_HOP;

/** The moment an envelope frame refers to, in seconds. */
export const frameTime = (frame: number, sampleRate: number, hopSize = ONSET_HOP): number =>
  (frame * hopSize + FRAME_LAG) / sampleRate;

/** How hard the log compression is. Higher lifts quiet detail further. */
export const COMPRESSION = 1000;

/** How far either side the maximum filter looks, in bands. */
export const VIBRATO_BANDS = 1;

/**
 * Log-spaced band edges, as FFT bin indexes.
 *
 * Twelve bands to the octave from 30 Hz up: fine enough to separate notes,
 * coarse enough that one band holds a whole partial rather than a sliver of it.
 */
export function bandEdges(sampleRate: number, fftSize: number, perOctave = 12): number[] {
  const bins = fftSize / 2;
  const binHz = sampleRate / fftSize;
  const edges: number[] = [];
  const top = Math.min(17000, sampleRate / 2);
  let frequency = 30;
  let last = -1;
  while (frequency <= top) {
    const bin = Math.round(frequency / binHz);
    if (bin > last && bin < bins) {
      edges.push(bin);
      last = bin;
    }
    frequency *= Math.pow(2, 1 / perOctave);
  }
  return edges;
}

/**
 * Total the magnitudes within each band, then compress.
 *
 * Compression happens after summing rather than before, so a band is judged by
 * the energy it actually holds.
 */
export function compressBands(
  magnitudes: Float64Array, edges: number[], out: Float64Array,
): void {
  for (let band = 0; band < edges.length - 1; band += 1) {
    let sum = 0;
    for (let bin = edges[band]; bin < edges[band + 1]; bin += 1) sum += magnitudes[bin];
    out[band] = Math.log(1 + COMPRESSION * sum);
  }
}

/**
 * Flux between two frames, ignoring energy that merely slid sideways.
 *
 * Only rises count: a note ending is not a note beginning. Each band is
 * compared against the loudest of its neighbours in the previous frame, so a
 * pitch wobbling between two bands does not read as an attack.
 */
export function bandFlux(current: Float64Array, previous: Float64Array, spread = VIBRATO_BANDS): number {
  let total = 0;
  for (let band = 0; band < current.length; band += 1) {
    let reference = 0;
    const from = Math.max(0, band - spread);
    const to = Math.min(current.length - 1, band + spread);
    for (let near = from; near <= to; near += 1) {
      if (previous[near] > reference) reference = previous[near];
    }
    const rise = current[band] - reference;
    if (rise > 0) total += rise;
  }
  return total;
}

/**
 * The onset strength of a signal, frame by frame.
 *
 * Normalised to a peak of one, so confidence figures are comparable between a
 * quiet recording and a loud one.
 */
export function onsetEnvelope(
  samples: Float32Array, sampleRate: number, hopSize = ONSET_HOP,
): Float32Array {
  const fftSize = nextPowerOfTwo(ONSET_WINDOW);
  if (samples.length < fftSize) return new Float32Array(0);

  const fft = new FFT(fftSize);
  const window = hann(fftSize);
  const edges = bandEdges(sampleRate, fftSize);
  const bandCount = Math.max(1, edges.length - 1);

  const frames = Math.floor((samples.length - fftSize) / hopSize);
  const envelope = new Float32Array(Math.max(0, frames));
  const magnitudes = new Float64Array(fftSize / 2);
  let previous = new Float64Array(bandCount);
  let current = new Float64Array(bandCount);

  for (let frame = 0; frame < frames; frame += 1) {
    fft.magnitudes(samples, frame * hopSize, window, magnitudes);
    compressBands(magnitudes, edges, current);
    envelope[frame] = frame === 0 ? 0 : bandFlux(current, previous);
    const swap = previous;
    previous = current;
    current = swap;
  }

  let peak = 0;
  for (let i = 0; i < envelope.length; i += 1) if (envelope[i] > peak) peak = envelope[i];
  if (peak > 0) for (let i = 0; i < envelope.length; i += 1) envelope[i] /= peak;
  return envelope;
}

/**
 * Subtract the local average, so a loud chorus does not swamp a quiet verse.
 *
 * Without this the tracker follows whichever section is loudest and loses the
 * beat everywhere else.
 */
export function removeDrift(envelope: Float32Array, window = 32): Float32Array {
  const out = new Float32Array(envelope.length);
  let sum = 0;
  for (let i = 0; i < envelope.length; i += 1) {
    sum += envelope[i];
    if (i >= window) sum -= envelope[i - window];
    const local = sum / Math.min(i + 1, window);
    out[i] = Math.max(0, envelope[i] - local);
  }
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) peak = Math.max(peak, out[i]);
  if (peak > 0) for (let i = 0; i < out.length; i += 1) out[i] /= peak;
  return out;
}
