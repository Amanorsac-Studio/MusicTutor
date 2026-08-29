/**
 * Web MIDI integration.
 *
 * Messages are decoded per the MIDI 1.0 Specification (MMA/AMEI):
 *   0x80 note off, 0x90 note on, 0xB0 control change, 0xE0 pitch bend.
 * Control changes handled: CC 64 (sustain), CC 120/123 (all sound/notes off),
 * CC 121 (reset all controllers).
 *
 * Every entry point resolves rather than throws. A browser without Web MIDI, or
 * a user who declines the permission prompt, must never prevent the rest of the
 * app from enumerating cameras and microphones.
 */

export type MidiPort = { id: string; name: string; manufacturer: string; state: string };

export type MidiStatus = {
  supported: boolean;
  granted: boolean;
  inputs: MidiPort[];
  outputs: MidiPort[];
  /** Human-readable reason when `granted` is false. */
  reason?: string;
};

export type MidiEvent =
  | { type: 'noteon'; note: number; velocity: number; channel: number; source: string }
  | { type: 'noteoff'; note: number; channel: number; source: string }
  | { type: 'sustain'; down: boolean; channel: number; source: string }
  | { type: 'allnotesoff'; channel: number; source: string }
  | { type: 'pitchbend'; value: number; channel: number; source: string };

const describePort = (port: MIDIPort): MidiPort => ({
  id: port.id,
  name: port.name || 'MIDI port',
  manufacturer: port.manufacturer || '',
  state: port.state,
});

export class MidiManager {
  private access?: MIDIAccess;
  private listeners = new Set<(event: MidiEvent) => void>();
  private statusListeners = new Set<(status: MidiStatus) => void>();
  private bound = new Set<MIDIInput>();
  private output?: MIDIOutput;
  private lastStatus: MidiStatus = { supported: false, granted: false, inputs: [], outputs: [] };
  /** Inputs the user has switched off; messages from them are ignored. */
  private enabledInputs?: Set<string>;
  private echoToOutput = false;

  get status(): MidiStatus {
    return this.lastStatus;
  }

  /**
   * Request Web MIDI access. Resolves with a status object describing what
   * happened — it never rejects.
   */
  async connect(): Promise<MidiStatus> {
    if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      return this.publish({
        supported: false,
        granted: false,
        inputs: [],
        outputs: [],
        reason: 'This browser does not support the Web MIDI API.',
      });
    }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      this.access = access;
      access.onstatechange = () => {
        this.bindInputs();
        this.publish(this.snapshot());
      };
      this.bindInputs();
      return this.publish(this.snapshot());
    } catch (error) {
      const reason =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'MIDI permission was declined. Allow MIDI access to use a connected keyboard.'
          : error instanceof Error
            ? error.message
            : 'MIDI could not be started.';
      return this.publish({ supported: true, granted: false, inputs: [], outputs: [], reason });
    }
  }

  private snapshot(): MidiStatus {
    if (!this.access) return { supported: true, granted: false, inputs: [], outputs: [] };
    return {
      supported: true,
      granted: true,
      inputs: [...this.access.inputs.values()].map(describePort),
      outputs: [...this.access.outputs.values()].map(describePort),
    };
  }

  private publish(status: MidiStatus): MidiStatus {
    this.lastStatus = status;
    this.statusListeners.forEach(listener => {
      try { listener(status); } catch { /* a bad listener must not break MIDI */ }
    });
    return status;
  }

  private bindInputs(): void {
    if (!this.access) return;
    const live = new Set<MIDIInput>();
    this.access.inputs.forEach(input => {
      live.add(input);
      if (this.bound.has(input)) return;
      input.onmidimessage = event => this.handleMessage(input, event);
      this.bound.add(input);
    });
    // Detach ports that have gone away so their handlers can be collected.
    [...this.bound].forEach(input => {
      if (!live.has(input)) {
        input.onmidimessage = null;
        this.bound.delete(input);
      }
    });
  }

  private handleMessage(input: MIDIInput, event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 2) return;
    if (this.enabledInputs && !this.enabledInputs.has(input.id)) return;

    const status = data[0];
    const command = status & 0xf0;
    const channel = status & 0x0f;
    const source = input.name || input.id;

    if (command === 0x90 && data[2] > 0) {
      this.dispatch({ type: 'noteon', note: data[1], velocity: data[2] / 127, channel, source });
    } else if (command === 0x80 || (command === 0x90 && data[2] === 0)) {
      this.dispatch({ type: 'noteoff', note: data[1], channel, source });
    } else if (command === 0xb0) {
      const controller = data[1];
      const value = data[2] ?? 0;
      if (controller === 64) this.dispatch({ type: 'sustain', down: value >= 64, channel, source });
      else if (controller === 120 || controller === 123) this.dispatch({ type: 'allnotesoff', channel, source });
      else if (controller === 121) {
        this.dispatch({ type: 'sustain', down: false, channel, source });
        this.dispatch({ type: 'allnotesoff', channel, source });
      }
    } else if (command === 0xe0) {
      const value = (((data[2] ?? 0) << 7) | data[1]) / 8192 - 1;
      this.dispatch({ type: 'pitchbend', value, channel, source });
    }
  }

  private dispatch(event: MidiEvent): void {
    this.listeners.forEach(listener => {
      try { listener(event); } catch { /* keep other listeners alive */ }
    });
  }

  subscribe(listener: (event: MidiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  onStatusChange(listener: (status: MidiStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  /** Restrict which input ports are listened to. `undefined` means all of them. */
  setEnabledInputs(ids: string[] | undefined): void {
    this.enabledInputs = ids ? new Set(ids) : undefined;
  }

  /**
   * Choose a hardware MIDI output. Pass an empty id to send nowhere, which is
   * the right default: echoing an incoming keyboard back to itself creates a
   * MIDI feedback loop.
   */
  selectOutput(id: string): boolean {
    this.output = id ? this.access?.outputs.get(id) : undefined;
    return Boolean(this.output);
  }

  get selectedOutputId(): string {
    return this.output?.id ?? '';
  }

  /** Whether notes arriving from a hardware input are forwarded to the output. */
  setEcho(enabled: boolean): void {
    this.echoToOutput = enabled;
  }

  get echoEnabled(): boolean {
    return this.echoToOutput;
  }

  sendNoteOn(note: number, velocity: number, channel = 0): void {
    this.output?.send([0x90 | (channel & 0x0f), note & 0x7f, Math.round(Math.min(1, Math.max(0, velocity)) * 127)]);
  }

  sendNoteOff(note: number, channel = 0): void {
    this.output?.send([0x80 | (channel & 0x0f), note & 0x7f, 0]);
  }

  sendAllNotesOff(channel = 0): void {
    this.output?.send([0xb0 | (channel & 0x0f), 123, 0]);
  }
}

export const midiManager = new MidiManager();
