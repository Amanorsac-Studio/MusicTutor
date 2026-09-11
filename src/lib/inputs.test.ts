import { describe, expect, it } from 'vitest';
import { INPUT_SLOTS, describeInputQuality, findSlot } from './inputs';

describe('input slots', () => {
  it('covers voice, a real keyboard line input, and app audio', () => {
    const ids = INPUT_SLOTS.map(slot => slot.id);
    expect(ids).toContain('mic1');
    expect(ids).toContain('inst1');
    expect(ids).toContain('inst2');
  });

  it('flags only the microphone slots as voice, so ducking triggers on speech', () => {
    const voice = INPUT_SLOTS.filter(slot => slot.isVoice).map(slot => slot.id);
    expect(voice).toEqual(['mic1', 'mic2']);
  });

  it('gives every slot a unique id and a hint', () => {
    expect(new Set(INPUT_SLOTS.map(s => s.id)).size).toBe(INPUT_SLOTS.length);
    INPUT_SLOTS.forEach(slot => {
      expect(slot.label).toBeTruthy();
      expect(slot.hint).toBeTruthy();
    });
  });

  it('explains how to capture a plug-in host on the app audio slot', () => {
    expect(findSlot('inst2')?.help).toMatch(/Kontakt/i);
    expect(findSlot('inst2')?.help).toMatch(/virtual audio device/i);
  });

  it('returns undefined for an unknown slot', () => {
    expect(findSlot('nope')).toBeUndefined();
  });
});

describe('describeInputQuality', () => {
  it('reports sample rate and channel count', () => {
    expect(describeInputQuality(2, 48000)).toBe('48 kHz · stereo');
    expect(describeInputQuality(1, 44100)).toBe('44.1 kHz · mono');
  });

  it('handles a partially reported device', () => {
    expect(describeInputQuality(undefined, 48000)).toBe('48 kHz');
    expect(describeInputQuality(2, undefined)).toBe('stereo');
    expect(describeInputQuality(undefined, undefined)).toBe('');
  });

  it('treats more than two channels as stereo or better', () => {
    expect(describeInputQuality(4, 96000)).toBe('96 kHz · stereo');
  });
});
