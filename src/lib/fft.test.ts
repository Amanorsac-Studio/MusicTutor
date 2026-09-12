import { describe, expect, it } from 'vitest';
import { FFT, bitReversalTable, hann, isPowerOfTwo, nextPowerOfTwo } from './fft';

describe('nextPowerOfTwo', () => {
  it('leaves a power of two alone', () => {
    expect(nextPowerOfTwo(1024)).toBe(1024);
  });

  it('rounds anything else up', () => {
    expect(nextPowerOfTwo(1000)).toBe(1024);
    expect(nextPowerOfTwo(3)).toBe(4);
  });
});

describe('isPowerOfTwo', () => {
  it('knows one when it sees one', () => {
    expect(isPowerOfTwo(2048)).toBe(true);
    expect(isPowerOfTwo(1)).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isPowerOfTwo(1000)).toBe(false);
    expect(isPowerOfTwo(0)).toBe(false);
    expect(isPowerOfTwo(-4)).toBe(false);
  });
});

describe('bitReversalTable', () => {
  it('reverses the bits of each index', () => {
    // Three bits: 0,4,2,6,1,5,3,7.
    expect([...bitReversalTable(8)]).toEqual([0, 4, 2, 6, 1, 5, 3, 7]);
  });

  it('is its own inverse', () => {
    const table = bitReversalTable(16);
    table.forEach((value, index) => expect(table[value]).toBe(index));
  });
});

describe('hann', () => {
  it('opens and closes at nothing', () => {
    const window = hann(64);
    expect(window[0]).toBeCloseTo(0, 9);
    expect(window[32]).toBeCloseTo(1, 9);
  });
});

describe('FFT', () => {
  it('refuses a size it cannot transform', () => {
    expect(() => new FFT(1000)).toThrow(/power of two/);
  });

  it('turns a constant into energy at zero frequency only', () => {
    const size = 16;
    const fft = new FFT(size);
    const real = new Float64Array(size).fill(1);
    const imag = new Float64Array(size);
    fft.transform(real, imag);
    expect(real[0]).toBeCloseTo(size, 6);
    for (let i = 1; i < size; i += 1) {
      expect(Math.hypot(real[i], imag[i])).toBeCloseTo(0, 6);
    }
  });

  it('puts a sine wave in its own bin and nowhere else', () => {
    const size = 64;
    const bin = 7;
    const fft = new FFT(size);
    const real = new Float64Array(size);
    const imag = new Float64Array(size);
    for (let i = 0; i < size; i += 1) real[i] = Math.sin((2 * Math.PI * bin * i) / size);
    fft.transform(real, imag);

    const magnitudes = Array.from({ length: size / 2 }, (_, i) => Math.hypot(real[i], imag[i]));
    const loudest = magnitudes.indexOf(Math.max(...magnitudes));
    expect(loudest).toBe(bin);
    // Everything else should be essentially silent.
    magnitudes.forEach((value, i) => {
      if (i !== bin) expect(value).toBeLessThan(magnitudes[bin] * 0.01);
    });
  });

  it('separates two tones that are present together', () => {
    const size = 128;
    const fft = new FFT(size);
    const real = new Float64Array(size);
    const imag = new Float64Array(size);
    for (let i = 0; i < size; i += 1) {
      real[i] = Math.sin((2 * Math.PI * 5 * i) / size) + 0.5 * Math.sin((2 * Math.PI * 20 * i) / size);
    }
    fft.transform(real, imag);
    const at = (bin: number) => Math.hypot(real[bin], imag[bin]);
    expect(at(5)).toBeGreaterThan(at(20));
    expect(at(20)).toBeGreaterThan(at(12) * 10);
  });

  it('conserves energy, as a transform must', () => {
    const size = 64;
    const fft = new FFT(size);
    const real = new Float64Array(size);
    const imag = new Float64Array(size);
    let seed = 7;
    for (let i = 0; i < size; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      real[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    const before = real.reduce((sum, value) => sum + value * value, 0);
    fft.transform(real, imag);
    let after = 0;
    for (let i = 0; i < size; i += 1) after += real[i] * real[i] + imag[i] * imag[i];
    // Parseval: the spectrum holds the same energy, scaled by the length.
    expect(after / size).toBeCloseTo(before, 6);
  });

  it('measures magnitudes of a windowed slice of a longer signal', () => {
    const size = 64;
    const fft = new FFT(size);
    const samples = new Float32Array(256);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.sin((2 * Math.PI * 8 * i) / size);
    }
    const out = new Float64Array(size / 2);
    fft.magnitudes(samples, 64, hann(size), out);
    const loudest = [...out].indexOf(Math.max(...out));
    expect(loudest).toBe(8);
  });

  it('reads past the end of a signal as silence rather than failing', () => {
    const fft = new FFT(32);
    const out = new Float64Array(16);
    expect(() => fft.magnitudes(new Float32Array(8), 0, hann(32), out)).not.toThrow();
  });
});
