import { describe, expect, it } from 'vitest';
import { buildMidiFile, writeVarLength, MidiRecorder, TICKS_PER_QUARTER } from './midiFile';

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.slice(start, start + length));

const readUint32 = (bytes: Uint8Array, at: number) =>
  (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];

describe('variable-length quantities (SMF spec)', () => {
  it('encodes the values given in the specification', () => {
    // These pairs are taken from the Standard MIDI File 1.0 spec table.
    expect(writeVarLength(0)).toEqual([0x00]);
    expect(writeVarLength(0x40)).toEqual([0x40]);
    expect(writeVarLength(0x7f)).toEqual([0x7f]);
    expect(writeVarLength(0x80)).toEqual([0x81, 0x00]);
    expect(writeVarLength(0x2000)).toEqual([0xc0, 0x00]);
    expect(writeVarLength(0x3fff)).toEqual([0xff, 0x7f]);
    expect(writeVarLength(0x100000)).toEqual([0xc0, 0x80, 0x00]);
    expect(writeVarLength(0x0fffffff)).toEqual([0xff, 0xff, 0xff, 0x7f]);
  });

  it('never emits a byte with the continuation bit set last', () => {
    for (const value of [1, 127, 128, 9999, 1_000_000]) {
      const bytes = writeVarLength(value);
      expect(bytes[bytes.length - 1] & 0x80).toBe(0);
      bytes.slice(0, -1).forEach(byte => expect(byte & 0x80).toBe(0x80));
    }
  });
});

describe('Standard MIDI File structure', () => {
  const file = buildMidiFile([
    { time: 0, type: 'noteon', note: 60, velocity: 0.8 },
    { time: 500, type: 'noteoff', note: 60 },
  ]);

  it('starts with a valid MThd header chunk', () => {
    expect(ascii(file, 0, 4)).toBe('MThd');
    expect(readUint32(file, 4)).toBe(6); // header length is always 6
  });

  it('declares format 0 with one track and the expected division', () => {
    expect((file[8] << 8) | file[9]).toBe(0); // format 0
    expect((file[10] << 8) | file[11]).toBe(1); // one track
    expect((file[12] << 8) | file[13]).toBe(TICKS_PER_QUARTER);
  });

  it('follows with an MTrk chunk whose declared length matches its contents', () => {
    expect(ascii(file, 14, 4)).toBe('MTrk');
    const declared = readUint32(file, 18);
    expect(file.length - 22).toBe(declared);
  });

  it('ends with the end-of-track meta event', () => {
    expect([...file.slice(-4)]).toEqual([0x00, 0xff, 0x2f, 0x00]);
  });

  it('contains a tempo meta event', () => {
    const bytes = [...file];
    const index = bytes.findIndex((b, i) => b === 0xff && bytes[i + 1] === 0x51 && bytes[i + 2] === 0x03);
    expect(index).toBeGreaterThan(-1);
  });

  it('writes a note-on and a note-off for the played note', () => {
    const bytes = [...file];
    expect(bytes.some((b, i) => b === 0x90 && bytes[i + 1] === 60)).toBe(true);
    expect(bytes.some((b, i) => b === 0x80 && bytes[i + 1] === 60)).toBe(true);
  });
});

describe('tempo-relative timing', () => {
  it('places a note half a second in at the right tick for 120 bpm', () => {
    // At 120 bpm a quarter note is 500 ms, so 500 ms = one quarter = 480 ticks.
    const file = buildMidiFile([{ time: 500, type: 'noteon', note: 60, velocity: 1 }], 120);
    const bytes = [...file];
    const noteOnIndex = bytes.findIndex((b, i) => b === 0x90 && bytes[i + 1] === 60);
    // Delta precedes the status byte; 480 encodes as 0x83 0x60.
    expect([bytes[noteOnIndex - 2], bytes[noteOnIndex - 1]]).toEqual([0x83, 0x60]);
  });

  it('sorts events that arrive out of order', () => {
    const file = buildMidiFile([
      { time: 900, type: 'noteoff', note: 64 },
      { time: 100, type: 'noteon', note: 64, velocity: 0.5 },
    ]);
    const bytes = [...file];
    const on = bytes.findIndex((b, i) => b === 0x90 && bytes[i + 1] === 64);
    const off = bytes.findIndex((b, i) => b === 0x80 && bytes[i + 1] === 64);
    expect(on).toBeLessThan(off);
  });
});

describe('velocity encoding', () => {
  it('maps 0..1 onto the MIDI 1..127 range', () => {
    const loud = buildMidiFile([{ time: 0, type: 'noteon', note: 60, velocity: 1 }]);
    const soft = buildMidiFile([{ time: 0, type: 'noteon', note: 60, velocity: 0.01 }]);
    const velocityOf = (file: Uint8Array) => {
      const bytes = [...file];
      const index = bytes.findIndex((b, i) => b === 0x90 && bytes[i + 1] === 60);
      return bytes[index + 2];
    };
    expect(velocityOf(loud)).toBe(127);
    expect(velocityOf(soft)).toBeGreaterThanOrEqual(1);
    expect(velocityOf(soft)).toBeLessThanOrEqual(127);
  });
});

describe('MidiRecorder', () => {
  it('ignores events until started', () => {
    const recorder = new MidiRecorder();
    recorder.noteOn(60, 0.8, 0);
    expect(recorder.eventCount).toBe(0);
  });

  it('captures notes relative to the start time', () => {
    const recorder = new MidiRecorder();
    recorder.start(1000);
    recorder.noteOn(60, 0.8, 1250);
    recorder.noteOff(60, 1750);
    const events = recorder.stop();
    expect(events).toHaveLength(2);
    expect(events[0].time).toBe(250);
    expect(events[1].time).toBe(750);
  });

  it('records sustain pedal changes', () => {
    const recorder = new MidiRecorder();
    recorder.start(0);
    recorder.sustain(true, 100);
    recorder.sustain(false, 400);
    const events = recorder.stop();
    expect(events.map(e => e.value)).toEqual([127, 0]);
  });

  it('discards the previous take when restarted', () => {
    const recorder = new MidiRecorder();
    recorder.start(0);
    recorder.noteOn(60, 0.8, 10);
    recorder.start(0);
    expect(recorder.eventCount).toBe(0);
  });

  it('produces a parseable file from a captured take', () => {
    const recorder = new MidiRecorder();
    recorder.start(0);
    recorder.noteOn(60, 0.8, 0);
    recorder.noteOn(64, 0.8, 0);
    recorder.noteOff(60, 500);
    recorder.noteOff(64, 500);
    recorder.stop();
    const file = recorder.build();
    expect(ascii(file, 0, 4)).toBe('MThd');
    expect(ascii(file, 14, 4)).toBe('MTrk');
  });
});
