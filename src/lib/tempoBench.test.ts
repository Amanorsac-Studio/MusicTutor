import { describe, expect, it, vi } from 'vitest';
import { detectTempo } from './tempo';

// These analyse seconds of real audio per case. Alone each takes under a
// second, but the suite runs files in parallel and they then compete for cores,
// so the default five-second allowance fails them on a busy machine for reasons
// that have nothing to do with whether the answer is right.
vi.setConfig({ testTimeout: 120_000 });


const RATE = 44100;

let seed = 20260913;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return (seed / 0xffffffff) * 2 - 1;
};

/** A drum-machine pattern: loud kicks, quieter hats, plenty of transient. */
function drums(bpm: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  const beat = (60 / bpm) * RATE;
  for (let i = 0; i * beat < out.length; i += 1) {
    const at = Math.round(i * beat);
    const accent = i % 4 === 0 ? 1 : 0.5;
    for (let s = 0; s < 2000 && at + s < out.length; s += 1) {
      const t = s / RATE;
      out[at + s] += accent * Math.exp(-t * 40) * Math.sin(2 * Math.PI * 55 * t);
      out[at + s] += accent * 0.3 * Math.exp(-t * 400) * random();
    }
  }
  return out;
}

/**
 * A piano part: chords held under a moving melody, no percussion at all.
 *
 * This is the case the old loudness-based detector could not do. The total
 * level barely moves, because the sustained chord dominates it; what changes is
 * which frequencies are present.
 */
function pianoWithSustain(bpm: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  const beat = (60 / bpm) * RATE;
  const note = (freq: number, at: number, length: number, level: number) => {
    for (let s = 0; s < length && at + s < out.length; s += 1) {
      const t = s / RATE;
      const env = Math.exp(-t * 1.6);
      out[at + s] += level * env * (
        Math.sin(2 * Math.PI * freq * t)
        + 0.4 * Math.sin(2 * Math.PI * freq * 2 * t)
        + 0.2 * Math.sin(2 * Math.PI * freq * 3 * t)
      );
    }
  };

  // A held chord every bar, loud and sustained.
  for (let bar = 0; bar * beat * 4 < out.length; bar += 1) {
    const at = Math.round(bar * beat * 4);
    [130.8, 164.8, 196].forEach(freq => note(freq, at, Math.round(beat * 4), 0.5));
  }
  // A melody on every beat, quieter than the chord underneath it.
  const tune = [523.3, 587.3, 659.3, 587.3, 523.3, 493.9, 523.3, 587.3];
  for (let i = 0; i * beat < out.length; i += 1) {
    note(tune[i % tune.length], Math.round(i * beat), Math.round(beat * 0.9), 0.22);
  }
  return out;
}

/** Nothing but noise: there is no tempo to find, and it should say so. */
function noise(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i += 1) out[i] = random() * 0.3;
  return out;
}

const within = (measured: number, expected: number, percent: number) =>
  Math.abs(measured - expected) / expected <= percent / 100;

describe('tempo detection on percussive music', () => {
  [72, 90, 100, 120, 128, 140, 168].forEach(bpm => {
    it(`reads a ${bpm} BPM drum pattern`, () => {
      const result = detectTempo(drums(bpm, 12), RATE);
      expect(within(result.bpm, bpm, 3)).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.3);
    });
  });
});

describe('tempo detection on sustained music without drums', () => {
  // The case the old detector failed: a melody over a held chord barely changes
  // the loudness, so only a spectral method finds the beat at all.
  [76, 96, 112, 132].forEach(bpm => {
    it(`reads a ${bpm} BPM piano part`, () => {
      const result = detectTempo(pianoWithSustain(bpm, 14), RATE);
      expect(within(result.bpm, bpm, 4)).toBe(true);
    });
  });
});

describe('tempo detection knows when it does not know', () => {
  it('is unsure about noise', () => {
    expect(detectTempo(noise(10), RATE).confidence).toBeLessThan(0.55);
  });

  it('is sure about a clean pattern', () => {
    expect(detectTempo(drums(120, 12), RATE).confidence).toBeGreaterThan(0.4);
  });

  it('says something harmless about a track too short to judge', () => {
    const result = detectTempo(new Float32Array(1000), RATE);
    expect(result.bpm).toBeGreaterThan(0);
    expect(result.confidence).toBe(0);
  });
});

describe('tempo alternatives', () => {
  it('offers other readings without repeating the one it chose', () => {
    const result = detectTempo(drums(120, 12), RATE);
    result.alternatives.forEach(bpm => {
      expect(Math.abs(bpm - result.bpm) / result.bpm).toBeGreaterThan(0.02);
    });
  });

  it('keeps its suggestions inside a usable range', () => {
    const result = detectTempo(drums(90, 12), RATE);
    result.alternatives.forEach(bpm => {
      expect(bpm).toBeGreaterThanOrEqual(40);
      expect(bpm).toBeLessThanOrEqual(250);
    });
  });
});

describe('the beat offset', () => {
  it('points at the first beat rather than the start of the file', () => {
    const silence = Math.round(RATE * 0.37);
    const pattern = drums(120, 10);
    const delayed = new Float32Array(silence + pattern.length);
    delayed.set(pattern, silence);
    const result = detectTempo(delayed, RATE);
    expect(result.offset).toBeGreaterThan(0.2);
    expect(result.offset).toBeLessThan(0.9);
  });
});
