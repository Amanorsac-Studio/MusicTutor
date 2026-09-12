/**
 * The last few chords played, for the notation staff.
 *
 * A learner watching a lesson needs to see what just happened, not only what is
 * sounding this instant: the bar of notation behind the playhead is what makes
 * a progression readable. So chords are kept as they are played and drawn in
 * order, oldest first.
 */

export type ChordEntry = {
  /** Stable identity, so a redraw does not restart an animation. */
  id: string;
  /** The notes that made the chord, low to high. */
  notes: number[];
  /** Chord name, such as Fmaj7. */
  symbol: string;
  /** Roman numeral in the current key, when one applies. */
  numeral?: string;
};

/** How many chords the staff shows behind the current one. */
export const HISTORY_LIMIT = 4;

let counter = 0;

export const createEntry = (
  notes: number[], symbol: string, numeral?: string,
): ChordEntry => ({
  id: `chord_${Date.now().toString(36)}_${(counter++).toString(36)}`,
  notes: [...notes].sort((a, b) => a - b),
  symbol,
  numeral,
});

/** Two chords are the same when they are the same notes in the same octaves. */
export const sameChord = (a: ChordEntry | undefined, b: ChordEntry): boolean =>
  Boolean(a) && a!.notes.length === b.notes.length && a!.notes.every((note, i) => note === b.notes[i]);

/**
 * Add a chord, dropping the oldest once the limit is reached.
 *
 * Replaying the same chord does not add a second copy: a teacher repeating a
 * shape to demonstrate it would otherwise fill the whole staff with one chord.
 */
export function pushChord(
  history: ChordEntry[], entry: ChordEntry, limit = HISTORY_LIMIT,
): ChordEntry[] {
  if (sameChord(history[history.length - 1], entry)) return history;
  const next = [...history, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * Whether a set of sounding notes is worth recording as a chord.
 *
 * Two notes are an interval, not a chord, and a single note is a melody. Three
 * is the smallest thing worth writing down as a harmony.
 */
export const isChordWorthKeeping = (notes: Set<number> | number[]): boolean =>
  (Array.isArray(notes) ? notes.length : notes.size) >= 3;

/**
 * Shared history, read by the compositor and written when notes are played.
 *
 * It lives outside React because the compositor paints from a plain callback
 * thirty times a second and must not depend on a render having happened.
 */
class ChordHistory {
  private entries: ChordEntry[] = [];
  private listeners = new Set<(entries: ChordEntry[]) => void>();

  get current(): ChordEntry[] {
    return this.entries;
  }

  subscribe(listener: (entries: ChordEntry[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.entries);
    return () => { this.listeners.delete(listener); };
  }

  push(notes: number[], symbol: string, numeral?: string): void {
    const next = pushChord(this.entries, createEntry(notes, symbol, numeral));
    if (next === this.entries) return;
    this.entries = next;
    this.publish();
  }

  clear(): void {
    if (!this.entries.length) return;
    this.entries = [];
    this.publish();
  }

  private publish(): void {
    this.listeners.forEach(listener => {
      try { listener(this.entries); } catch { /* a bad listener must not stop playing */ }
    });
  }
}

export const chordHistory = new ChordHistory();

/**
 * The columns the staff should draw: the recent chords, then what is sounding.
 *
 * The live column is dropped when it repeats the newest history entry, which
 * happens for the moment a chord is still held after being recorded — without
 * this the same chord would appear twice side by side.
 */
export function staffColumns(
  history: ChordEntry[],
  sounding: number[],
  liveLabel?: string,
  limit = HISTORY_LIMIT,
): Array<{ id: string; notes: number[]; label?: string; live?: boolean }> {
  const notes = [...sounding].sort((a, b) => a - b);
  const newest = history[history.length - 1];
  const duplicate = Boolean(newest)
    && newest.notes.length === notes.length
    && newest.notes.every((note, i) => note === notes[i]);

  const live = notes.length && !duplicate
    ? [{ id: 'live', notes, label: liveLabel, live: true }]
    : [];
  const past = history
    .slice(Math.max(0, history.length - (limit - live.length)))
    .map(entry => ({ id: entry.id, notes: entry.notes, label: entry.symbol, live: false }));

  // A held chord that is already in the history is still the live one.
  if (duplicate && past.length) past[past.length - 1].live = true;
  return [...past, ...live];
}
