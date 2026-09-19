import { describe, expect, it } from 'vitest';
import { markMelody, notesAt, notesBetween, tidyNotes, usedRange, type RollNote } from './transcribe';

const note = (start: number, end: number, midi: number, velocity = 0.6): RollNote =>
  ({ start, end, midi, velocity, melody: false });

describe('tidyNotes', () => {
  it('keeps real notes', () => {
    expect(tidyNotes([{ start: 0, end: 0.5, midi: 60, velocity: 0.5 }])).toHaveLength(1);
  });

  it('drops blips too short to be a played note', () => {
    expect(tidyNotes([{ start: 0, end: 0.03, midi: 60, velocity: 0.8 }])).toHaveLength(0);
  });

  it('drops faint ghosts', () => {
    expect(tidyNotes([{ start: 0, end: 0.5, midi: 72, velocity: 0.05 }])).toHaveLength(0);
  });

  it('drops anything off the piano', () => {
    expect(tidyNotes([
      { start: 0, end: 0.5, midi: 10, velocity: 0.8 },
      { start: 0, end: 0.5, midi: 120, velocity: 0.8 },
    ])).toHaveLength(0);
  });

  it('sorts by time, which everything downstream relies on', () => {
    const tidy = tidyNotes([
      { start: 2, end: 2.5, midi: 60, velocity: 0.5 },
      { start: 1, end: 1.5, midi: 64, velocity: 0.5 },
    ]);
    expect(tidy.map(n => n.start)).toEqual([1, 2]);
  });

  it('rounds a bent pitch to the key it belongs on', () => {
    expect(tidyNotes([{ start: 0, end: 0.5, midi: 60.4, velocity: 0.5 }])[0].midi).toBe(60);
  });
});

describe('joinFragments', () => {
  it('joins the stub of an attack to the note it belongs to', () => {
    const joined = tidyNotes([
      { start: 1, end: 1.06, midi: 36, velocity: 0.4 },
      { start: 1.07, end: 1.5, midi: 36, velocity: 0.7 },
    ]);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ start: 1, end: 1.5, velocity: 0.7 });
  });

  it('leaves the same key played twice as two notes', () => {
    expect(tidyNotes([
      { start: 1, end: 1.45, midi: 36, velocity: 0.6 },
      { start: 1.46, end: 1.9, midi: 36, velocity: 0.6 },
    ])).toHaveLength(2);
  });

  it('never joins across different keys', () => {
    expect(tidyNotes([
      { start: 1, end: 1.1, midi: 36, velocity: 0.6 },
      { start: 1.1, end: 1.5, midi: 37, velocity: 0.6 },
    ])).toHaveLength(2);
  });
});

describe('markMelody', () => {
  it('marks the top note of a chord as the tune', () => {
    const marked = markMelody([note(0, 1, 60), note(0, 1, 64), note(0, 1, 72)]);
    expect(marked.find(n => n.midi === 72)?.melody).toBe(true);
    expect(marked.find(n => n.midi === 64)?.melody).toBe(false);
    expect(marked.find(n => n.midi === 60)?.melody).toBe(false);
  });

  it('follows a tune moving over a held chord', () => {
    const marked = markMelody([
      note(0, 4, 48), note(0, 4, 55),
      note(0, 1, 72), note(1, 2, 74), note(2, 3, 76),
    ]);
    expect(marked.filter(n => n.melody).map(n => n.midi)).toEqual([72, 74, 76]);
  });

  it('does not call a bass line the melody, even when nothing is above it', () => {
    expect(markMelody([note(0, 1, 40)])[0].melody).toBe(false);
  });

  it('lets a lower note be the tune once the higher one has ended', () => {
    const marked = markMelody([note(0, 1, 76), note(1.5, 2.5, 67)]);
    expect(marked.every(n => n.melody)).toBe(true);
  });
});

describe('notesAt', () => {
  const notes = [note(0, 1, 60), note(0.5, 2, 64), note(3, 4, 67)];

  it('finds what is sounding at a moment', () => {
    expect(notesAt(notes, 0.75).map(n => n.midi)).toEqual([60, 64]);
  });

  it('lets go of a note the moment it ends', () => {
    expect(notesAt(notes, 1).map(n => n.midi)).toEqual([64]);
  });

  it('finds nothing in a gap', () => {
    expect(notesAt(notes, 2.5)).toEqual([]);
  });
});

describe('notesBetween', () => {
  const notes = [note(0, 1, 60), note(2, 3, 64), note(5, 6, 67)];

  it('returns the notes on screen', () => {
    expect(notesBetween(notes, 1.5, 4).map(n => n.midi)).toEqual([64]);
  });

  it('includes a note that started before the window but is still sounding', () => {
    expect(notesBetween(notes, 0.5, 1.5).map(n => n.midi)).toEqual([60]);
  });
});

describe('usedRange', () => {
  it('covers the notes with a little room', () => {
    const range = usedRange([note(0, 1, 40), note(0, 1, 80)]);
    expect(range.low).toBeLessThanOrEqual(40);
    expect(range.high).toBeGreaterThanOrEqual(80);
  });

  it('opens a narrow tune out to at least two octaves', () => {
    const range = usedRange([note(0, 1, 60), note(1, 2, 62)]);
    expect(range.high - range.low).toBeGreaterThanOrEqual(24);
  });

  it('stays on the piano', () => {
    const range = usedRange([note(0, 1, 21), note(0, 1, 108)]);
    expect(range.low).toBeGreaterThanOrEqual(21);
    expect(range.high).toBeLessThanOrEqual(108);
  });

  it('gives a sensible middle range when there is nothing yet', () => {
    expect(usedRange([])).toEqual({ low: 48, high: 84 });
  });
});
