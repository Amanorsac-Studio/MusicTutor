import { describe, expect, it } from 'vitest';
import {
  aftersoundLevel, brightnessDecay, buildSpectrum, damperTime, finalBrightness,
  frequencyOfNote, fundamentalDecay, hammerDecay, hammerLevel, hammerTone,
  impulseResponse, inharmonicityB, initialBrightness, initialDecay, noteGain,
  notePan, partialAmplitude, partialCount, partialFrequency, unisonDetune,
} from './piano';

describe('frequencyOfNote', () => {
  it('puts concert A where the standard says', () => {
    expect(frequencyOfNote(69)).toBeCloseTo(440, 6);
    expect(frequencyOfNote(60)).toBeCloseTo(261.6256, 3);
    expect(frequencyOfNote(21)).toBeCloseTo(27.5, 4);
    expect(frequencyOfNote(108)).toBeCloseTo(4186.009, 2);
  });

  it('follows a different tuning', () => {
    expect(frequencyOfNote(69, 442)).toBeCloseTo(442, 6);
  });
});

describe('inharmonicityB', () => {
  it('is smallest in the middle of the keyboard', () => {
    expect(inharmonicityB(48)).toBeLessThan(inharmonicityB(21));
    expect(inharmonicityB(48)).toBeLessThan(inharmonicityB(96));
  });

  it('climbs far more steeply into the treble than into the bass', () => {
    const upFromCentre = inharmonicityB(48 + 24) / inharmonicityB(48);
    const downFromCentre = inharmonicityB(48 - 24) / inharmonicityB(48);
    expect(upFromCentre).toBeGreaterThan(downFromCentre);
  });

  it('stays within the range real pianos show', () => {
    for (let note = 21; note <= 108; note += 1) {
      expect(inharmonicityB(note)).toBeGreaterThan(0);
      expect(inharmonicityB(note)).toBeLessThanOrEqual(0.05);
    }
  });
});

describe('partialFrequency', () => {
  it('is an exact multiple when the string is ideal', () => {
    expect(partialFrequency(100, 3, 0)).toBeCloseTo(300, 6);
  });

  it('pushes partials sharp, and the high ones more', () => {
    const b = 0.0004;
    const second = partialFrequency(100, 2, b) / 200;
    const tenth = partialFrequency(100, 10, b) / 1000;
    expect(second).toBeGreaterThan(1);
    expect(tenth).toBeGreaterThan(second);
  });
});

describe('partialAmplitude', () => {
  it('silences the partials the hammer cannot excite', () => {
    // Striking at an eighth of the string puts a node on partials 8, 16, 24.
    expect(partialAmplitude(8, 0.7)).toBeCloseTo(0, 10);
    expect(partialAmplitude(16, 0.7)).toBeCloseTo(0, 10);
    expect(partialAmplitude(7, 0.7)).toBeGreaterThan(0);
  });

  it('keeps more upper partials for a hard strike than a soft one', () => {
    const soft = partialAmplitude(6, 0.15) / partialAmplitude(1, 0.15);
    const hard = partialAmplitude(6, 0.95) / partialAmplitude(1, 0.95);
    expect(hard).toBeGreaterThan(soft);
  });

  it('falls off as the partial number rises', () => {
    expect(partialAmplitude(3, 0.7)).toBeLessThan(partialAmplitude(1, 0.7));
  });

  it('follows a different strike point', () => {
    expect(partialAmplitude(5, 0.7, 0.2)).toBeCloseTo(0, 10);
    expect(partialAmplitude(8, 0.7, 0.2)).toBeGreaterThan(0);
  });

  it('is zero below the fundamental', () => {
    expect(partialAmplitude(0, 0.7)).toBe(0);
  });
});

describe('partialCount', () => {
  it('keeps every partial under the Nyquist limit', () => {
    const count = partialCount(440, 48000);
    expect(440 * count).toBeLessThan(24000);
  });

  it('gives a top note only a few partials', () => {
    expect(partialCount(4186, 48000)).toBeLessThan(6);
  });

  it('caps a bass note rather than generating hundreds', () => {
    expect(partialCount(27.5, 48000, 48)).toBe(48);
  });

  it('never returns less than the fundamental', () => {
    expect(partialCount(30000, 48000)).toBe(1);
    expect(partialCount(0, 48000)).toBe(0);
  });
});

describe('buildSpectrum', () => {
  it('leaves the DC term at zero, or the waveform is offset', () => {
    expect(buildSpectrum(261.6, 0.7, 48000)[0]).toBe(0);
  });

  it('normalises so dynamics come from the envelope, not the spectrum', () => {
    const soft = buildSpectrum(261.6, 0.2, 48000);
    const hard = buildSpectrum(261.6, 0.9, 48000);
    expect(Math.max(...soft)).toBeCloseTo(1, 6);
    expect(Math.max(...hard)).toBeCloseTo(1, 6);
  });

  it('carries the hammer notch through into the wave', () => {
    const spectrum = buildSpectrum(261.6, 0.7, 48000);
    expect(spectrum[8]).toBeCloseTo(0, 8);
  });

  it('gets shorter as the note rises', () => {
    expect(buildSpectrum(4186, 0.7, 48000).length)
      .toBeLessThan(buildSpectrum(261.6, 0.7, 48000).length);
  });
});

describe('decay curves', () => {
  it('rings far longer in the bass than the treble', () => {
    expect(fundamentalDecay(21)).toBeGreaterThan(fundamentalDecay(60));
    expect(fundamentalDecay(60)).toBeGreaterThan(fundamentalDecay(108));
  });

  it('keeps every decay to a plausible length', () => {
    expect(fundamentalDecay(21)).toBeLessThanOrEqual(30);
    expect(fundamentalDecay(108)).toBeGreaterThanOrEqual(0.45);
  });

  it('makes the first stage much shorter than the whole note', () => {
    for (const note of [21, 48, 72, 108]) {
      expect(initialDecay(note)).toBeLessThan(fundamentalDecay(note));
    }
  });

  it('leaves a quiet tail after the fast stage, louder for a hard strike', () => {
    expect(aftersoundLevel(0.2)).toBeLessThan(aftersoundLevel(0.9));
    expect(aftersoundLevel(0.9)).toBeLessThan(0.5);
  });

  it('darkens the treble faster than the bass', () => {
    expect(brightnessDecay(21)).toBeGreaterThan(brightnessDecay(96));
  });
});

describe('brightness', () => {
  it('opens up for a hard strike', () => {
    expect(initialBrightness(261.6, 0.9)).toBeGreaterThan(initialBrightness(261.6, 0.2));
  });

  it('starts brighter than it finishes, so the tone darkens as it rings', () => {
    for (const [frequency, velocity] of [[65, 0.8], [261.6, 0.5], [1046, 0.9]] as const) {
      expect(initialBrightness(frequency, velocity)).toBeGreaterThan(finalBrightness(frequency));
    }
  });

  it('never asks the filter for more than the audible band', () => {
    expect(initialBrightness(4186, 1)).toBeLessThanOrEqual(16000);
  });

  it('keeps a bass note from being filtered into nothing', () => {
    expect(initialBrightness(27.5, 0.05)).toBeGreaterThanOrEqual(320);
  });
});

describe('damperTime', () => {
  it('takes longer on a thick bass string than a thin treble one', () => {
    expect(damperTime(21)).toBeGreaterThan(damperTime(84));
  });

  it('lets the top octave and a half ring, as it has no dampers', () => {
    expect(damperTime(96)).toBeGreaterThan(damperTime(92));
  });

  it('is never instant, which would click', () => {
    for (let note = 21; note <= 108; note += 1) {
      expect(damperTime(note)).toBeGreaterThanOrEqual(0.08);
    }
  });
});

describe('the hammer', () => {
  it('grows faster than loudness does', () => {
    const quiet = hammerLevel(0.3);
    const loud = hammerLevel(0.9);
    expect(loud / quiet).toBeGreaterThan(3);
  });

  it('is a thud low down and a click at the top', () => {
    expect(hammerTone(27.5)).toBeLessThan(hammerTone(1046));
  });

  it('is always short, and shorter when struck hard', () => {
    expect(hammerDecay(0.9)).toBeLessThan(hammerDecay(0.2));
    expect(hammerDecay(0.2)).toBeLessThan(0.05);
  });
});

describe('unisonDetune', () => {
  it('spreads the treble more than the bass', () => {
    expect(unisonDetune(96)).toBeGreaterThan(unisonDetune(24));
  });

  it('stays small enough to shimmer rather than sound out of tune', () => {
    for (let note = 21; note <= 108; note += 1) {
      expect(unisonDetune(note)).toBeLessThanOrEqual(4.2);
      expect(unisonDetune(note)).toBeGreaterThan(0);
    }
  });
});

describe('notePan', () => {
  it('puts middle C in the centre', () => {
    expect(notePan(60)).toBeCloseTo(0, 6);
  });

  it('puts the bass left and the treble right', () => {
    expect(notePan(24)).toBeLessThan(0);
    expect(notePan(96)).toBeGreaterThan(0);
  });

  it('keeps the instrument narrower than the whole stereo field', () => {
    expect(Math.abs(notePan(21))).toBeLessThanOrEqual(0.42);
    expect(Math.abs(notePan(108))).toBeLessThanOrEqual(0.42);
  });
});

describe('noteGain', () => {
  it('rises with velocity', () => {
    expect(noteGain(60, 0.9)).toBeGreaterThan(noteGain(60, 0.3));
  });

  it('gives the bass more energy, since the ear hears less of it', () => {
    expect(noteGain(28, 0.7)).toBeGreaterThan(noteGain(60, 0.7));
  });

  it('never asks for a level that would clip on its own', () => {
    for (let note = 21; note <= 108; note += 1) {
      // Comfortably under unity: the limiter is a safety net, not a mixer.
      expect(noteGain(note, 1)).toBeLessThan(0.95);
    }
  });
});

describe('impulseResponse', () => {
  it('produces both channels at the asked-for length', () => {
    const { left, right } = impulseResponse(48000, 1);
    expect(left.length).toBe(48000);
    expect(right.length).toBe(48000);
  });

  it('decays, so the tail is quieter than the start', () => {
    const { left } = impulseResponse(48000, 1);
    const early = left.slice(1000, 3000).reduce((sum, x) => sum + Math.abs(x), 0);
    const late = left.slice(44000, 46000).reduce((sum, x) => sum + Math.abs(x), 0);
    expect(late).toBeLessThan(early * 0.2);
  });

  it('is the same every time, so the reverb does not change between sessions', () => {
    const a = impulseResponse(48000, 0.2);
    const b = impulseResponse(48000, 0.2);
    expect([...a.left.slice(0, 50)]).toEqual([...b.left.slice(0, 50)]);
  });

  it('differs between the two channels, or it would collapse to mono', () => {
    const { left, right } = impulseResponse(48000, 0.2);
    expect([...left.slice(0, 50)]).not.toEqual([...right.slice(0, 50)]);
  });

  it('has early reflections standing above the diffuse noise', () => {
    const { left } = impulseResponse(48000, 1);
    const reflection = Math.abs(left[Math.floor(0.0081 * 48000)]);
    const neighbour = Math.abs(left[Math.floor(0.0081 * 48000) + 40]);
    expect(reflection).toBeGreaterThan(neighbour);
  });
});
