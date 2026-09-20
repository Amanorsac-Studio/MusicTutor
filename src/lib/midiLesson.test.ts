import { describe, expect, it } from 'vitest';
import { buildMidiFile, type RecordedMidiEvent } from './midiFile';
import { chordsFromNotes, parseMidi } from './midiLesson';
import { chordLabel } from './chordTrack';
import type { RollNote } from './transcribe';

/** A note as the recorder writes it: an on and an off, in milliseconds. */
const played = (midi: number, from: number, to: number, velocity = 0.7): RecordedMidiEvent[] => [
  { time: from * 1000, type: 'noteon', note: midi, velocity },
  { time: to * 1000, type: 'noteoff', note: midi },
];

const note = (midi: number, start: number, end: number): RollNote =>
  ({ midi, start, end, velocity: 0.7, melody: false });

describe('parseMidi', () => {
  it('reads back what the recorder wrote, to the millisecond', () => {
    const file = buildMidiFile([...played(60, 0.5, 1.25), ...played(64, 2, 3.5)]);
    const { notes, duration } = parseMidi(file);
    expect(notes.map(n => n.midi)).toEqual([60, 64]);
    expect(notes[0].start).toBeCloseTo(0.5, 2);
    expect(notes[0].end).toBeCloseTo(1.25, 2);
    expect(notes[1].start).toBeCloseTo(2, 2);
    expect(duration).toBeCloseTo(3.5, 2);
  });

  it('keeps how hard each note was played', () => {
    const { notes } = parseMidi(buildMidiFile([...played(60, 0, 1, 0.3), ...played(62, 1, 2, 1)]));
    expect(notes[0].velocity).toBeCloseTo(0.3, 1);
    expect(notes[1].velocity).toBeCloseTo(1, 1);
  });

  it('follows the tempo the file states, not an assumed one', () => {
    // The same ticks at 60 BPM take twice as long as at 120.
    const at120 = parseMidi(buildMidiFile(played(60, 1, 2), 120)).notes[0];
    const at60 = parseMidi(buildMidiFile(played(60, 1, 2), 60)).notes[0];
    expect(at60.start).toBeCloseTo(at120.start, 2);
    expect(at60.end - at60.start).toBeCloseTo(1, 2);
  });

  it('pairs the same key played twice correctly', () => {
    const { notes } = parseMidi(buildMidiFile([...played(60, 0, 0.5), ...played(60, 1, 1.5)]));
    expect(notes).toHaveLength(2);
    expect(notes[1].start).toBeCloseTo(1, 2);
  });

  it('ends a note that was never released where the file ends', () => {
    const { notes } = parseMidi(buildMidiFile([
      { time: 0, type: 'noteon', note: 60, velocity: 0.7 },
      ...played(64, 1, 2),
    ]));
    expect(notes.find(n => n.midi === 60)?.end).toBeGreaterThanOrEqual(2 - 0.01);
  });

  it('marks the top line as the tune', () => {
    const { notes } = parseMidi(buildMidiFile([...played(48, 0, 2), ...played(72, 0, 2)]));
    expect(notes.find(n => n.midi === 72)?.melody).toBe(true);
    expect(notes.find(n => n.midi === 48)?.melody).toBe(false);
  });

  it('ignores the sustain pedal and other controllers', () => {
    const { notes } = parseMidi(buildMidiFile([
      { time: 0, type: 'sustain', value: 127 }, ...played(60, 0.1, 0.6), { time: 900, type: 'sustain', value: 0 },
    ]));
    expect(notes).toHaveLength(1);
  });

  it('refuses something that is not MIDI, plainly', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))).toThrow(/not a MIDI file/);
    expect(() => parseMidi(new Uint8Array(3))).toThrow(/not a MIDI file/);
  });

  it('refuses a file cut off mid-note without hanging', () => {
    const file = buildMidiFile(played(60, 0, 1));
    expect(() => parseMidi(file.slice(0, file.length - 7))).toThrow();
  });
});

describe('chordsFromNotes', () => {
  const beats = Array.from({ length: 16 }, (_, i) => (i + 1) * 0.5);

  it('names a held triad', () => {
    const chords = chordsFromNotes([note(60, 0, 4), note(64, 0, 4), note(67, 0, 4)], beats, 8);
    expect(chordLabel(chords[0], 'sharp')).toBe('C');
  });

  it('follows a progression exactly where it changes', () => {
    const notes = [
      ...[60, 64, 67].map(m => note(m, 0, 2)),
      ...[57, 60, 64].map(m => note(m, 2, 4)),
      ...[53, 57, 60].map(m => note(m, 4, 6)),
      ...[55, 59, 62].map(m => note(m, 6, 8)),
    ];
    const chords = chordsFromNotes(notes, beats, 8);
    expect(chords.map(c => chordLabel(c, 'sharp'))).toEqual(['C', 'Am', 'F', 'G']);
    expect(chords[1].start).toBeCloseTo(2, 1);
    expect(chords[2].start).toBeCloseTo(4, 1);
  });

  it('is not fooled by a melody over the chord', () => {
    const notes = [
      ...[48, 55, 60, 64].map(m => note(m, 0, 4)),
      note(72, 0, 0.5), note(74, 0.5, 1), note(76, 1, 1.5), note(74, 1.5, 2),
    ];
    expect(chordLabel(chordsFromNotes(notes, beats, 4)[0], 'sharp')).toBe('C');
  });

  it('says a slash chord when the bass is on the third', () => {
    const chords = chordsFromNotes([note(40, 0, 4), note(60, 0, 4), note(67, 0, 4), note(72, 0, 4)], beats, 4);
    expect(chordLabel(chords[0], 'sharp')).toBe('C/E');
  });

  it('leaves silence as silence', () => {
    const chords = chordsFromNotes([note(60, 0, 1), note(64, 0, 1), note(67, 0, 1), note(60, 6, 7), note(64, 6, 7), note(67, 6, 7)], beats, 8);
    const names = chords.map(c => chordLabel(c, 'sharp'));
    expect(names[0]).toBe('C');
    expect(names).toContain('—');
    expect(names.filter(name => name === 'C')).toHaveLength(2);
  });

  it('gives nothing for nothing', () => {
    expect(chordsFromNotes([], beats, 8)).toEqual([]);
  });
});
