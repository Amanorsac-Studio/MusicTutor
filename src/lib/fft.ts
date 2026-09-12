/**
 * A fast Fourier transform, for looking at what frequencies are present.
 *
 * Needed because the old tempo detector worked on loudness alone. Loudness only
 * rises when a note is louder than what came before, so a melody over a steady
 * accompaniment produced almost no signal at all, and a piano piece with no
 * drums barely registered. Looking at the spectrum instead catches a new note
 * appearing at its own pitch, whatever else is sounding.
 *
 * Radix-2 in place, which needs a power-of-two length. That is not a limitation
 * in practice: analysis windows are chosen, not given.
 */

/** The next power of two at or above n, which is the only length this accepts. */
export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

export const isPowerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

/**
 * Bit-reversal permutation, precomputed for a given size.
 *
 * The transform reads its input in bit-reversed order. Computing that order
 * once per size and reusing it is most of the difference between this being
 * fast and being merely correct.
 */
export function bitReversalTable(size: number): Uint32Array {
  const table = new Uint32Array(size);
  let bits = 0;
  while ((1 << bits) < size) bits += 1;
  for (let i = 0; i < size; i += 1) {
    let reversed = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      if (i & (1 << bit)) reversed |= 1 << (bits - 1 - bit);
    }
    table[i] = reversed;
  }
  return table;
}

/**
 * A transform of one fixed size, with its tables built once.
 *
 * Analysing a track means thousands of transforms of the same length, so the
 * twiddle factors and the bit-reversal order are worth keeping.
 */
export class FFT {
  readonly size: number;
  private readonly reversal: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(size: number) {
    if (!isPowerOfTwo(size)) throw new Error('FFT size must be a power of two');
    this.size = size;
    this.reversal = bitReversalTable(size);
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i += 1) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
  }

  /**
   * Transform in place. `real` and `imag` are both of length `size`.
   *
   * For real input, pass zeros in `imag`; the result is symmetric, so only the
   * first half of the bins carries anything new.
   */
  transform(real: Float64Array, imag: Float64Array): void {
    const { size, reversal, cos, sin } = this;

    for (let i = 0; i < size; i += 1) {
      const j = reversal[i];
      if (j > i) {
        let swap = real[i]; real[i] = real[j]; real[j] = swap;
        swap = imag[i]; imag[i] = imag[j]; imag[j] = swap;
      }
    }

    for (let span = 2; span <= size; span *= 2) {
      const half = span / 2;
      const step = size / span;
      for (let start = 0; start < size; start += span) {
        for (let k = 0; k < half; k += 1) {
          const twiddle = k * step;
          const wr = cos[twiddle];
          const wi = sin[twiddle];
          const a = start + k;
          const b = a + half;
          const tr = real[b] * wr - imag[b] * wi;
          const ti = real[b] * wi + imag[b] * wr;
          real[b] = real[a] - tr;
          imag[b] = imag[a] - ti;
          real[a] += tr;
          imag[a] += ti;
        }
      }
    }
  }

  /** Magnitude of each bin up to the Nyquist limit, for real input. */
  magnitudes(samples: Float32Array, offset: number, window: Float64Array, out: Float64Array): void {
    const { size } = this;
    const real = new Float64Array(size);
    const imag = new Float64Array(size);
    for (let i = 0; i < size; i += 1) {
      real[i] = (samples[offset + i] ?? 0) * window[i];
    }
    this.transform(real, imag);
    const bins = size / 2;
    for (let i = 0; i < bins; i += 1) {
      out[i] = Math.hypot(real[i], imag[i]);
    }
  }
}

/** A Hann window, which is the usual choice for spectral analysis. */
export function hann(size: number): Float64Array {
  const window = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  }
  return window;
}
