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
  /** When it was recorded, for deciding whether a fuller reading replaces it. */
  at: number;
  /** The notes that made the chord, low to high. */
  notes: number[];
  /** Chord name, such as Fmaj7. */
  symbol: string;
  /** Roman numeral in the current key, when one applies. */
  numeral?: string;
};

/** How many chords the staff shows behind the current one. */
export const HISTORY_LIMIT = 4;

/**
 * How long a chord must be held still before it is written down, in ms.
 *
 * Without this the staff fills with rubbish. Nobody puts four fingers down at
 * exactly the same instant: playing a C major triad from the bottom up passes
 * through C, then a bare fifth, then the triad, and recording each step gives
 * three meaningless entries for one chord. Waiting for the hand to settle
 * records what was meant rather than how it was reached.
 */
export const SETTLE_MS = 170;

/**
 * How long a just-recorded chord can still be replaced by a fuller one, in ms.
 *
 * A rolled or spread chord takes longer than the settle time to complete, so
 * the first reading lands early. When the notes that follow only add to what
 * was already there, they are the same chord finishing rather than a new one.
 */
export const SUPERSEDE_MS = 1400;

let counter = 0;

export const createEntry = (
  notes: number[], symbol: string, numeral?: string, at = Date.now(),
): ChordEntry => ({
  id: `chord_${at.toString(36)}_${(counter++).toString(36)}`,
  at,
  notes: [...notes].sort((a, b) => a - b),
  symbol,
  numeral,
});

/**
 * Whether the newer chord is the older one still being played.
 *
 * True when it keeps every note the older one had and adds at least one more,
 * which is what a spread chord looks like as the hand completes it.
 */
export function isSameChordGrowing(
  older: ChordEntry | undefined, newer: ChordEntry, withinMs = SUPERSEDE_MS,
): boolean {
  if (!older) return false;
  if (newer.at - older.at > withinMs) return false;
  if (newer.notes.length <= older.notes.length) return false;
  const held = new Set(newer.notes);
  return older.notes.every(note => held.has(note));
}

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
  const newest = history[history.length - 1];
  if (sameChord(newest, entry)) return history;

  // A chord that is still being spread replaces its own earlier reading, so
  // one gesture leaves one entry rather than a trail of partial ones.
  if (isSameChordGrowing(newest, entry)) {
    return [...history.slice(0, -1), entry];
  }

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
