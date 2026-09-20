/**
 * Reading a lesson's MIDI back in.
 *
 * A teacher's recorded lesson carries the notes as they were actually played,
 * which is a different kind of thing from every other source in the Learn tab.
 * Everything else there is *inferred* from sound — a network guessing which
 * notes are in a mix, a spectrum guessing which chord. Played notes are not a
 * guess. So a lesson that comes with its MIDI gets the real notes on the roll,
 * and its chords are worked out from those notes, not from how they sounded.
 */

import {
  CHORD_SHAPES, decodeSlices, scoreFrame, undecidedSlice,
  type ChordSegment, type ChordSlice,
} from './chordTrack';
import { markMelody, type RollNote } from './transcribe';

export type ParsedMidi = {
  notes: RollNote[];
  /** Seconds, to the last note off. */
  duration: number;
};

/** The events of one track, with absolute times in ticks. */
type RawEvent =
  | { tick: number; kind: 'tempo'; microsPerQuarter: number }
  | { tick: number; kind: 'on'; channel: number; note: number; velocity: number }
  | { tick: number; kind: 'off'; channel: number; note: number };

class Reader {
  position = 0;
  constructor(readonly bytes: Uint8Array) {}
  get done(): boolean { return this.position >= this.bytes.length; }
  u8(): number {
    if (this.position >= this.bytes.length) throw new Error('This MIDI file ends in the middle of a note.');
    return this.bytes[this.position++];
  }
  u16(): number { return (this.u8() << 8) | this.u8(); }
  u32(): number { return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0; }
  text(length: number): string {
    let out = '';
    for (let i = 0; i < length; i += 1) out += String.fromCharCode(this.u8());
    return out;
  }
  varLength(): number {
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('This MIDI file has a time value that does not make sense.');
  }
}

function readTrack(reader: Reader, end: number): RawEvent[] {
  const events: RawEvent[] = [];
  let tick = 0;
  let running = 0;
  while (reader.position < end) {
    tick += reader.varLength();
    let status = reader.u8();
    if (status < 0x80) {
      // Running status: this byte is data for the previous command.
      if (!running) throw new Error('This MIDI file starts a command without saying which.');
      reader.position -= 1;
      status = running;
    } else if (status < 0xf0) {
      running = status;
    }

    if (status === 0xff) {
      const type = reader.u8();
      const length = reader.varLength();
      if (type === 0x51 && length === 3) {
        events.push({ tick, kind: 'tempo', microsPerQuarter: (reader.u8() << 16) | (reader.u8() << 8) | reader.u8() });
      } else {
        reader.position += length;
      }
      if (type === 0x2f) break;
    } else if (status === 0xf0 || status === 0xf7) {
      reader.position += reader.varLength();
    } else {
      const command = status & 0xf0;
      const channel = status & 0x0f;
      const first = reader.u8();
      // Program change and channel pressure carry one data byte, the rest two.
      const second = command === 0xc0 || command === 0xd0 ? 0 : reader.u8();
      if (command === 0x90 && second > 0) events.push({ tick, kind: 'on', channel, note: first, velocity: second });
      else if (command === 0x80 || command === 0x90) events.push({ tick, kind: 'off', channel, note: first });
    }
  }
  return events;
}

/**
 * Parse a Standard MIDI File into notes on a timeline in seconds.
 *
 * Handles what real files contain — several tracks, running status, tempo
 * changes — and refuses the one thing it cannot time, files counted in
 * SMPTE frames rather than beats.
 */
export function parseMidi(bytes: Uint8Array): ParsedMidi {
  const reader = new Reader(bytes);
  if (bytes.length < 14 || reader.text(4) !== 'MThd') throw new Error('That is not a MIDI file.');
  const headerLength = reader.u32();
  reader.u16(); // format: tracks are merged whichever it is
  const trackCount = reader.u16();
  const division = reader.u16();
  if (division & 0x8000) throw new Error('This MIDI file is timed in film frames, which lessons do not use.');
  reader.position = 8 + headerLength;

  const events: RawEvent[] = [];
  for (let track = 0; track < trackCount && !reader.done; track += 1) {
    if (reader.text(4) !== 'MTrk') throw new Error('This MIDI file has a damaged track.');
    const length = reader.u32();
    const end = Math.min(bytes.length, reader.position + length);
    events.push(...readTrack(reader, end));
    reader.position = end;
  }
  events.sort((a, b) => a.tick - b.tick);

  // Ticks to seconds through the tempo map, which starts at 120 BPM by rule.
  const tempoChanges: Array<{ tick: number; seconds: number; micros: number }> = [{ tick: 0, seconds: 0, micros: 500000 }];
  events.forEach(event => {
    if (event.kind !== 'tempo') return;
    const last = tempoChanges[tempoChanges.length - 1];
    const seconds = last.seconds + ((event.tick - last.tick) * last.micros) / division / 1e6;
    tempoChanges.push({ tick: event.tick, seconds, micros: event.microsPerQuarter });
  });
  const toSeconds = (tick: number): number => {
    let at = tempoChanges[0];
    for (const change of tempoChanges) { if (change.tick <= tick) at = change; else break; }
    return at.seconds + ((tick - at.tick) * at.micros) / division / 1e6;
  };

  const sounding = new Map<string, Array<{ start: number; velocity: number }>>();
  const notes: RollNote[] = [];
  let duration = 0;
  events.forEach(event => {
    // Channel 10 is percussion: its "notes" are drums, not pitches.
    if (event.kind === 'tempo' || event.channel === 9) return;
    const key = `${event.channel}:${event.note}`;
    const time = toSeconds(event.tick);
    if (event.kind === 'on') {
      const stack = sounding.get(key) ?? [];
      stack.push({ start: time, velocity: event.velocity / 127 });
      sounding.set(key, stack);
    } else {
      const started = sounding.get(key)?.shift();
      if (!started) return;
      notes.push({ start: started.start, end: Math.max(time, started.start + 0.02), midi: event.note, velocity: started.velocity, melody: false });
      duration = Math.max(duration, time);
    }
  });
  // A note never released ends where the file does.
  sounding.forEach((stack, key) => {
    const midi = Number(key.split(':')[1]);
    stack.forEach(started => {
      notes.push({ start: started.start, end: Math.max(duration, started.start + 0.25), midi, velocity: started.velocity, melody: false });
    });
  });
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return { notes: markMelody(notes), duration };
}

/**
 * Name the chords a MIDI performance plays.
 *
 * The same decision as for a recording — a score for every chord in every
 * beat, then the steadiest path through them — but scored from the notes that
 * were held rather than from a spectrum. Nothing here is blurred by reverb,
 * drums or the mix, so it is the most reliable chord reading the app makes.
 */
export function chordsFromNotes(notes: RollNote[], beats: number[], duration: number): ChordSegment[] {
  if (!notes.length || duration <= 0) return [];
  let edges = beats.filter(beat => beat > 0 && beat < duration);
  if (edges.length < 4) {
    edges = [];
    for (let t = 0.5; t < duration; t += 0.5) edges.push(t);
  }
  edges = [0, ...edges, duration];

  const slices: ChordSlice[] = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const start = edges[i];
    const end = edges[i + 1];
    if (end - start < 0.05) continue;
    const harmony = new Float32Array(12);
    const held = new Set<number>();
    let lowest = Infinity;
    let weight = 0;
    notes.forEach(note => {
      const overlap = Math.min(end, note.end) - Math.max(start, note.start);
      if (overlap <= 0) return;
      // A note held through the slice counts for more than a grace note in it.
      const share = overlap / (end - start);
      harmony[note.midi % 12] += share * (0.5 + note.velocity);
      weight += share;
      if (share >= 0.3) { held.add(note.midi % 12); lowest = Math.min(lowest, note.midi); }
    });
    if (weight < 0.05) { slices.push({ start, end, scores: null }); continue; }
    // One or two pitch classes cannot say which chord they belong to.
    if (held.size < 2) { slices.push(undecidedSlice(start, end)); continue; }
    const bass = new Float32Array(12);
    if (Number.isFinite(lowest)) bass[lowest % 12] = 1;
    slices.push({ start, end, scores: scoreFrame(harmony, bass, 0.2) });
  }
  const segments = decodeSlices(slices);

  // Where the lowest held note is a chord note that is not the root: D♭/F.
  segments.forEach(segment => {
    if (segment.root < 0 || !segment.quality) return;
    let lowest: RollNote | null = null;
    notes.forEach(note => {
      const overlap = Math.min(segment.end, note.end) - Math.max(segment.start, note.start);
      if (overlap < 0.25) return;
      if (!lowest || note.midi < lowest.midi) lowest = note;
    });
    if (!lowest) return;
    const pc = (lowest as RollNote).midi % 12;
    const interval = (pc - segment.root + 12) % 12;
    if (interval !== 0 && CHORD_SHAPES[segment.quality].includes(interval)) segment.bass = pc;
  });
  return segments;
}
