import { describe, expect, it } from 'vitest';
import {
  NoteTracker, decimate, detectPitch, frequencyToMidi, rms, type PitchReading,
} from './pitch';

const RATE = 48000;

/**
 * A bass-like tone: the fundamental deliberately weaker than its second
 * harmonic, which is what a real bass sounds like and what breaks a detector
 * that looks for the loudest frequency.
 */
function bassTone(frequency: number, seconds = 0.2, fundamental = 0.35): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    out[i] = 0.5 * (
      fundamental * Math.sin(2 * Math.PI * frequency * t)
      + 1.0 * Math.sin(2 * Math.PI * frequency * 2 * t + 0.4)
      + 0.5 * Math.sin(2 * Math.PI * frequency * 3 * t + 1.1)
    );
  }
  return out;
}

/** As the app hears it: decimated, then analysed. */
const hear = (samples: Float32Array) => detectPitch(decimate(samples, 4), RATE / 4);

const midiToFrequency = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

describe('rms', () => {
  it('measures a full-scale sine at about 0.707', () => {
    const sine = new Float32Array(4800);
    for (let i = 0; i < sine.length; i += 1) sine[i] = Math.sin((2 * Math.PI * 100 * i) / RATE);
    expect(rms(sine)).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('is zero for silence', () => {
    expect(rms(new Float32Array(100))).toBe(0);
  });
});

describe('decimate', () => {
  it('shortens by the factor', () => {
    expect(decimate(new Float32Array(4096), 4)).toHaveLength(1024);
  });

  it('returns the input untouched at a factor of one', () => {
    const samples = new Float32Array(16);
    expect(decimate(samples, 1)).toBe(samples);
  });

  it('keeps a low tone recognisable', () => {
    const reading = hear(bassTone(55));
    expect(reading).not.toBeNull();
    expect(Math.abs(reading!.frequency - 55)).toBeLessThan(0.5);
  });
});

describe('detectPitch', () => {
  it('names every open string of a five-string bass', () => {
    [23, 28, 33, 38, 43].forEach(midi => {
      const reading = hear(bassTone(midiToFrequency(midi)));
      expect(reading, `midi ${midi}`).not.toBeNull();
      expect(Math.round(frequencyToMidi(reading!.frequency))).toBe(midi);
    });
  });

  it('finds the fundamental even when the second harmonic is far louder', () => {
    // The octave error this whole method exists to avoid.
    const reading = hear(bassTone(41.2, 0.2, 0.12));
    expect(reading).not.toBeNull();
    expect(Math.round(frequencyToMidi(reading!.frequency))).toBe(28);
  });

  it('is accurate to a few cents, enough for a tuning readout', () => {
    const reading = hear(bassTone(110));
    const cents = 1200 * Math.log2(reading!.frequency / 110);
    expect(Math.abs(cents)).toBeLessThan(5);
  });

  it('follows every semitone up the neck', () => {
    for (let midi = 28; midi <= 55; midi += 1) {
      const reading = hear(bassTone(midiToFrequency(midi)));
      expect(reading, `midi ${midi}`).not.toBeNull();
      expect(Math.round(frequencyToMidi(reading!.frequency))).toBe(midi);
    }
  });

  it('works from the short window the app actually uses', () => {
    // 4096 samples at 48 kHz: about 85 ms, the latency budget for a low B.
    const reading = hear(bassTone(midiToFrequency(23), 4096 / RATE));
    expect(reading).not.toBeNull();
    expect(Math.round(frequencyToMidi(reading!.frequency))).toBe(23);
  });

  it('says nothing about silence', () => {
    expect(hear(new Float32Array(9600))).toBeNull();
  });

  it('says nothing about noise, which has no pitch', () => {
    const noise = new Float32Array(9600);
    let seed = 99;
    for (let i = 0; i < noise.length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      noise[i] = ((seed / 0xffffffff) * 2 - 1) * 0.4;
    }
    expect(hear(noise)).toBeNull();
  });

  it('reports high clarity for a clean tone', () => {
    expect(hear(bassTone(82.4))!.clarity).toBeGreaterThan(0.8);
  });

  it('copes with a block too short to analyse', () => {
    expect(detectPitch(new Float32Array(8), RATE)).toBeNull();
  });
});

describe('frequencyToMidi', () => {
  it('puts concert A at 69', () => {
    expect(frequencyToMidi(440)).toBeCloseTo(69, 9);
  });

  it('follows a different tuning standard', () => {
    expect(frequencyToMidi(442, 442)).toBeCloseTo(69, 9);
  });
});

describe('NoteTracker', () => {
  const reading = (midi: number, detune = 0): PitchReading => ({
    frequency: midiToFrequency(midi + detune / 100), clarity: 0.95, rms: 0.2,
  });

  it('waits for a note to be read twice before showing it', () => {
    const tracker = new NoteTracker();
    expect(tracker.update(reading(33))).toBeNull();
    expect(tracker.update(reading(33))?.midi).toBe(33);
  });

  it('ignores a single stray reading in the middle of a held note', () => {
    const tracker = new NoteTracker();
    tracker.update(reading(33));
    tracker.update(reading(33));
    expect(tracker.update(reading(45))?.midi).toBe(33);
    expect(tracker.update(reading(33))?.midi).toBe(33);
  });

  it('moves to a new note once it is confirmed', () => {
    const tracker = new NoteTracker();
    tracker.update(reading(33));
    tracker.update(reading(33));
    tracker.update(reading(35));
    expect(tracker.update(reading(35))?.midi).toBe(35);
  });

  it('holds a note through a brief dropout', () => {
    const tracker = new NoteTracker();
    tracker.update(reading(33));
    tracker.update(reading(33));
    expect(tracker.update(null)?.midi).toBe(33);
    expect(tracker.update(null)?.midi).toBe(33);
  });

  it('lets go once the silence has lasted', () => {
    const tracker = new NoteTracker();
    tracker.update(reading(33));
    tracker.update(reading(33));
    tracker.update(null);
    tracker.update(null);
    expect(tracker.update(null)).toBeNull();
  });

  it('reports how sharp or flat the note is', () => {
    const tracker = new NoteTracker();
    tracker.update(reading(33, 20));
    expect(tracker.update(reading(33, 20))?.cents).toBe(20);
  });

  it('keeps up with a fast line: a new note every three readings', () => {
    const tracker = new NoteTracker();
    const seen: number[] = [];
    [33, 35, 36, 38, 40].forEach(midi => {
      for (let i = 0; i < 3; i += 1) {
        const note = tracker.update(reading(midi));
        if (note && seen[seen.length - 1] !== note.midi) seen.push(note.midi);
      }
    });
    expect(seen).toEqual([33, 35, 36, 38, 40]);
  });

  it('starts clean after a reset', () => {
    const tracker = new NoteTracker();
    tracker.update(reading(33));
    tracker.update(reading(33));
    tracker.reset();
    expect(tracker.note).toBeNull();
  });
});
