import { beforeEach, describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT, SETTLE_MS, SUPERSEDE_MS, chordHistory, createEntry,
  isChordWorthKeeping, isSameChordGrowing, pushChord, sameChord, staffColumns,
} from './chordHistory';

const entry = (notes: number[], symbol = 'C') => createEntry(notes, symbol);

describe('pushChord', () => {
  it('keeps chords in the order they were played', () => {
    let history = pushChord([], entry([60, 64, 67], 'C'));
    history = pushChord(history, entry([65, 69, 72], 'F'));
    expect(history.map(item => item.symbol)).toEqual(['C', 'F']);
  });

  it('ignores the same chord played twice in a row', () => {
    const history = pushChord([], entry([60, 64, 67]));
    expect(pushChord(history, entry([60, 64, 67]))).toBe(history);
  });

  it('records a chord again once something else has intervened', () => {
    let history = pushChord([], entry([60, 64, 67], 'C'));
    history = pushChord(history, entry([65, 69, 72], 'F'));
    history = pushChord(history, entry([60, 64, 67], 'C'));
    expect(history.map(item => item.symbol)).toEqual(['C', 'F', 'C']);
  });

  it('drops the oldest once four are held', () => {
    let history: ReturnType<typeof entry>[] = [];
    ['C', 'F', 'G', 'Am', 'Dm'].forEach((symbol, index) => {
      history = pushChord(history, entry([60 + index, 64 + index, 67 + index], symbol));
    });
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history.map(item => item.symbol)).toEqual(['F', 'G', 'Am', 'Dm']);
  });

  it('treats the same chord in a different octave as a different chord', () => {
    const history = pushChord([], entry([60, 64, 67]));
    expect(pushChord(history, entry([72, 76, 79]))).toHaveLength(2);
  });

  it('replaces a partial reading when the chord finishes, rather than adding', () => {
    const at = 500_000;
    const history = pushChord([], createEntry([60, 64], 'C', undefined, at));
    const settled = pushChord(history, createEntry([60, 64, 67], 'C', undefined, at + 200));
    expect(settled).toHaveLength(1);
    expect(settled[0].notes).toEqual([60, 64, 67]);
  });

  it('does not let one growing chord swallow the one before it', () => {
    const at = 500_000;
    let history = pushChord([], createEntry([53, 57, 60], 'F', undefined, at));
    history = pushChord(history, createEntry([60, 64, 67], 'C', undefined, at + 200));
    expect(history.map(item => item.symbol)).toEqual(['F', 'C']);
  });
});

describe('isSameChordGrowing', () => {
  const at = 1_000_000;

  it('recognises a spread chord completing', () => {
    const first = createEntry([60, 64], 'C', undefined, at);
    const full = createEntry([60, 64, 67], 'C', undefined, at + 300);
    expect(isSameChordGrowing(first, full)).toBe(true);
  });

  it('does not treat a different chord as the same one growing', () => {
    const first = createEntry([60, 64, 67], 'C', undefined, at);
    const next = createEntry([62, 65, 69, 72], 'Dm7', undefined, at + 300);
    expect(isSameChordGrowing(first, next)).toBe(false);
  });

  it('does not treat a chord losing a note as growing', () => {
    const full = createEntry([60, 64, 67], 'C', undefined, at);
    const fewer = createEntry([60, 64], 'C', undefined, at + 300);
    expect(isSameChordGrowing(full, fewer)).toBe(false);
  });

  it('stops replacing once the window has passed', () => {
    const first = createEntry([60, 64], 'C', undefined, at);
    const later = createEntry([60, 64, 67], 'C', undefined, at + SUPERSEDE_MS + 1);
    expect(isSameChordGrowing(first, later)).toBe(false);
  });

  it('handles there being nothing before it', () => {
    expect(isSameChordGrowing(undefined, createEntry([60, 64, 67], 'C'))).toBe(false);
  });
});

describe('the settle time', () => {
  it('is long enough to cover a hand landing, short enough to feel immediate', () => {
    expect(SETTLE_MS).toBeGreaterThanOrEqual(100);
    expect(SETTLE_MS).toBeLessThanOrEqual(300);
  });
});

describe('sameChord', () => {
  it('matches whatever order the notes arrived in', () => {
    expect(sameChord(entry([67, 60, 64]), entry([60, 64, 67]))).toBe(true);
  });

  it('does not match a chord with an extra note', () => {
    expect(sameChord(entry([60, 64, 67]), entry([60, 64, 67, 71]))).toBe(false);
  });

  it('does not match nothing', () => {
    expect(sameChord(undefined, entry([60, 64, 67]))).toBe(false);
  });
});

describe('isChordWorthKeeping', () => {
  it('needs three notes', () => {
    expect(isChordWorthKeeping([60, 64, 67])).toBe(true);
    expect(isChordWorthKeeping(new Set([60, 64, 67]))).toBe(true);
  });

  it('ignores a single note or an interval', () => {
    expect(isChordWorthKeeping([60])).toBe(false);
    expect(isChordWorthKeeping(new Set([60, 67]))).toBe(false);
    expect(isChordWorthKeeping([])).toBe(false);
  });
});

describe('staffColumns', () => {
  const history = [entry([60, 64, 67], 'C'), entry([65, 69, 72], 'F')];

  it('draws the history when nothing is sounding', () => {
    const columns = staffColumns(history, []);
    expect(columns.map(column => column.label)).toEqual(['C', 'F']);
    expect(columns.every(column => !column.live)).toBe(true);
  });

  it('adds what is being played as a live column at the end', () => {
    const columns = staffColumns(history, [62, 65, 69], 'Dm');
    expect(columns).toHaveLength(3);
    expect(columns[2].live).toBe(true);
    expect(columns[2].label).toBe('Dm');
  });

  it('does not repeat a held chord that is already the newest', () => {
    const columns = staffColumns(history, [65, 69, 72], 'F');
    expect(columns).toHaveLength(2);
    expect(columns[1].live).toBe(true);
    expect(columns[1].label).toBe('F');
  });

  it('never shows more than four columns', () => {
    const full = ['C', 'F', 'G', 'Am'].map((symbol, i) => entry([60 + i, 64 + i, 67 + i], symbol));
    expect(staffColumns(full, [50, 54, 57], 'D')).toHaveLength(HISTORY_LIMIT);
  });

  it('keeps the newest history entries when it has to drop some', () => {
    const full = ['C', 'F', 'G', 'Am'].map((symbol, i) => entry([60 + i, 64 + i, 67 + i], symbol));
    const columns = staffColumns(full, [50, 54, 57], 'D');
    expect(columns.map(column => column.label)).toEqual(['F', 'G', 'Am', 'D']);
  });

  it('sorts the sounding notes low to high', () => {
    const columns = staffColumns([], [67, 60, 64]);
    expect(columns[0].notes).toEqual([60, 64, 67]);
  });

  it('shows only the live chord when nothing has been played before', () => {
    const columns = staffColumns([], [60, 64, 67], 'C');
    expect(columns).toHaveLength(1);
    expect(columns[0].live).toBe(true);
  });
});

describe('the shared history', () => {
  beforeEach(() => chordHistory.clear());

  it('tells subscribers when a chord is added', () => {
    const seen: number[] = [];
    const stop = chordHistory.subscribe(entries => seen.push(entries.length));
    chordHistory.push([60, 64, 67], 'C');
    chordHistory.push([65, 69, 72], 'F');
    stop();
    expect(seen).toEqual([0, 1, 2]);
  });

  it('stays quiet when the same chord is pushed again', () => {
    chordHistory.push([60, 64, 67], 'C');
    const seen: number[] = [];
    const stop = chordHistory.subscribe(entries => seen.push(entries.length));
    chordHistory.push([60, 64, 67], 'C');
    stop();
    expect(seen).toEqual([1]);
  });

  it('stops telling a subscriber that has unsubscribed', () => {
    const seen: number[] = [];
    const stop = chordHistory.subscribe(entries => seen.push(entries.length));
    stop();
    chordHistory.push([60, 64, 67], 'C');
    expect(seen).toEqual([0]);
  });
});
