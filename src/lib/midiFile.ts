/**
 * Standard MIDI File writer (SMF Type 0), per the MMA Standard MIDI File 1.0
 * specification. Produces a single-track file that any DAW or notation program
 * can open, so a recorded lesson is portable rather than locked to this app.
 */

export type RecordedMidiEvent = {
  /** Milliseconds from the start of the recording. */
  time: number;
  type: 'noteon' | 'noteoff' | 'sustain';
  note?: number;
  velocity?: number;
  /** For sustain events. */
  value?: number;
  channel?: number;
};

/** Ticks per quarter note. 480 is the common DAW default. */
export const TICKS_PER_QUARTER = 480;

/** Encode a number as an SMF variable-length quantity. */
export function writeVarLength(value: number): number[] {
  const clamped = Math.max(0, Math.floor(value));
  const bytes = [clamped & 0x7f];
  let remaining = clamped >> 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>= 7;
  }
  return bytes;
}

const text = (value: string): number[] => [...value].map(char => char.charCodeAt(0) & 0xff);

const uint32 = (value: number): number[] => [
  (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff,
];

const uint16 = (value: number): number[] => [(value >>> 8) & 0xff, value & 0xff];

/**
 * Build a Standard MIDI File from timestamped events.
 *
 * @param events Events in any order; they are sorted by time.
 * @param bpm    Tempo written into the file's tempo meta event.
 */
export function buildMidiFile(events: RecordedMidiEvent[], bpm = 120): Uint8Array {
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const msPerTick = 60000 / bpm / TICKS_PER_QUARTER;

  const track: number[] = [];

  // Tempo meta event: FF 51 03 tttttt (microseconds per quarter note).
  const microsecondsPerQuarter = Math.round(60000000 / bpm);
  track.push(
    0x00, 0xff, 0x51, 0x03,
    (microsecondsPerQuarter >> 16) & 0xff,
    (microsecondsPerQuarter >> 8) & 0xff,
    microsecondsPerQuarter & 0xff,
  );
  // Time signature 4/4, 24 MIDI clocks per metronome click, 8 32nds per quarter.
  track.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  let lastTick = 0;
  for (const event of sorted) {
    const tick = Math.round(event.time / msPerTick);
    const delta = Math.max(0, tick - lastTick);
    lastTick = tick;
    const channel = (event.channel ?? 0) & 0x0f;

    track.push(...writeVarLength(delta));
    if (event.type === 'noteon') {
      track.push(0x90 | channel, (event.note ?? 60) & 0x7f, Math.round(Math.min(127, Math.max(1, (event.velocity ?? 0.7) * 127))));
    } else if (event.type === 'noteoff') {
      track.push(0x80 | channel, (event.note ?? 60) & 0x7f, 0x40);
    } else {
      track.push(0xb0 | channel, 64, Math.min(127, Math.max(0, Math.round(event.value ?? 0))));
    }
  }

  // End of track: FF 2F 00
  track.push(0x00, 0xff, 0x2f, 0x00);

  const header = [
    ...text('MThd'), ...uint32(6),
    ...uint16(0), // format 0 — single multi-channel track
    ...uint16(1), // one track
    ...uint16(TICKS_PER_QUARTER),
  ];
  const trackChunk = [...text('MTrk'), ...uint32(track.length), ...track];

  return new Uint8Array([...header, ...trackChunk]);
}

/** Collects live MIDI/keyboard activity for later export. */
export class MidiRecorder {
  private events: RecordedMidiEvent[] = [];
  private startedAt = 0;
  private active = false;

  start(now = performance.now()): void {
    this.events = [];
    this.startedAt = now;
    this.active = true;
  }

  stop(): RecordedMidiEvent[] {
    this.active = false;
    return this.events;
  }

  get recording(): boolean {
    return this.active;
  }

  get eventCount(): number {
    return this.events.length;
  }

  noteOn(note: number, velocity: number, now = performance.now()): void {
    if (this.active) this.events.push({ time: now - this.startedAt, type: 'noteon', note, velocity });
  }

  noteOff(note: number, now = performance.now()): void {
    if (this.active) this.events.push({ time: now - this.startedAt, type: 'noteoff', note });
  }

  sustain(down: boolean, now = performance.now()): void {
    if (this.active) this.events.push({ time: now - this.startedAt, type: 'sustain', value: down ? 127 : 0 });
  }

  build(bpm = 120): Uint8Array {
    return buildMidiFile(this.events, bpm);
  }
}
