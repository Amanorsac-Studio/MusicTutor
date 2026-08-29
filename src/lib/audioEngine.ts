/**
 * PianoTutor audio engine.
 *
 * Signal flow:
 *
 *   mic / line inputs ─┐
 *                      ├─> channel gain ─> channel analyser ─┬─> program bus ─> master gain
 *   built-in synth ────┘                                     │                     │
 *                                                            │              ┌──────┴──────┐
 *   (voice channels feed the ducking sidechain) ──────────────┘              │             │
 *                                                                     limiter ─> speakers  └─> recording tap
 *
 * Everything the viewer hears also reaches the recording tap, so a lesson
 * capture contains the piano, not just whatever the microphone picked up.
 *
 * Levels are reported in dBFS (0 dBFS = full scale) per AES17 / EBU R 128
 * conventions, with a -60 dBFS noise floor for meter display.
 */

import { frequencyOf } from './chords';

export const METER_FLOOR_DB = -60;

export type ChannelKind = 'input' | 'instrument' | 'master';

export type ChannelState = {
  id: string;
  label: string;
  kind: ChannelKind;
  deviceId?: string;
  /** Linear fader position, 0..1. */
  gain: number;
  muted: boolean;
  soloed: boolean;
  /** true when this channel drives the ducking sidechain (i.e. a voice mic). */
  isVoice: boolean;
  connected: boolean;
  error?: string;
};

export type ChannelLevel = {
  /** RMS level in dBFS, clamped to METER_FLOOR_DB. */
  rms: number;
  /** Peak sample level in dBFS. */
  peak: number;
  /** 0..1 meter position derived from rms, for display. */
  meter: number;
  /** true if any sample reached digital full scale since the last read. */
  clipping: boolean;
};

const toDb = (amplitude: number): number =>
  amplitude <= 0 ? METER_FLOOR_DB : Math.max(METER_FLOOR_DB, 20 * Math.log10(amplitude));

/** Map dBFS onto a 0..1 meter scale. */
export const dbToMeter = (db: number): number =>
  Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));

/**
 * Fader taper. A linear slider maps to gain via an exponential curve so the
 * travel feels like a real console rather than bunching all the useful range
 * into the top few percent.
 */
export const faderToGain = (position: number): number => {
  if (position <= 0) return 0;
  return Math.pow(Math.min(1, position), 2.2);
};

export const gainToDb = (gain: number): number => (gain <= 0 ? -Infinity : 20 * Math.log10(gain));

type ChannelNodes = {
  state: ChannelState;
  source?: MediaStreamAudioSourceNode | GainNode;
  stream?: MediaStream;
  gain: GainNode;
  analyser: AnalyserNode;
  buffer: Float32Array;
};

export class AudioEngine {
  private ctx?: AudioContext;
  private programBus?: GainNode;
  private masterGain?: GainNode;
  private limiter?: DynamicsCompressorNode;
  private duckGain?: GainNode;
  private recordingTap?: MediaStreamAudioDestinationNode;
  private monitorGain?: GainNode;

  private channels = new Map<string, ChannelNodes>();
  private synthChannel?: ChannelNodes;
  private voices = new Map<number, { oscillators: OscillatorNode[]; gain: GainNode; released: boolean }>();
  private sustained = new Set<number>();
  private sustainPedal = false;

  private duckingEnabled = true;
  private duckAmountDb = -6;
  private duckThresholdDb = -38;
  private listeners = new Set<(note: number, on: boolean, velocity: number) => void>();

  private masterAnalyser?: AnalyserNode;
  private masterBuffer = new Float32Array(1024);

  /** Concert pitch in Hz — adjustable for ensembles that do not tune to 440. */
  concertPitch = 440;

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  /** Create the graph on first use. Safe to call repeatedly. */
  ensure(): AudioContext {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.programBus = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.duckGain.gain.value = 1;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = faderToGain(0.8);

    this.limiter = ctx.createDynamicsCompressor();
    // Brick-wall-ish safety limiter: catches peaks without audible pumping.
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;

    this.masterAnalyser = ctx.createAnalyser();
    this.masterAnalyser.fftSize = 2048;
    this.masterBuffer = new Float32Array(this.masterAnalyser.fftSize);

    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = 1;

    this.recordingTap = ctx.createMediaStreamDestination();

    this.programBus.connect(this.duckGain);
    this.duckGain.connect(this.masterGain);
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.masterAnalyser);
    // Speakers pass through the monitor fader; the recording tap does not, so
    // muting your monitors never silences the recording.
    this.masterAnalyser.connect(this.monitorGain);
    this.monitorGain.connect(ctx.destination);
    this.masterAnalyser.connect(this.recordingTap);

    this.synthChannel = this.createChannelNodes({
      id: 'instrument',
      label: 'Piano / MIDI instrument',
      kind: 'instrument',
      gain: 0.8,
      muted: false,
      soloed: false,
      isVoice: false,
      connected: true,
    });
    const synthInput = ctx.createGain();
    synthInput.connect(this.synthChannel.gain);
    this.synthChannel.source = synthInput;
    this.channels.set('instrument', this.synthChannel);

    return ctx;
  }

  get context(): AudioContext | undefined {
    return this.ctx;
  }

  get isRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Stream carrying the full program mix, for MediaRecorder. */
  get recordingStream(): MediaStream | undefined {
    return this.recordingTap?.stream;
  }

  async resume(): Promise<void> {
    this.ensure();
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
  }

  async close(): Promise<void> {
    this.allNotesOff();
    for (const id of [...this.channels.keys()]) this.removeChannel(id);
    await this.ctx?.close().catch(() => {});
    this.ctx = undefined;
  }

  /* ---------------------------------------------------------------- *
   * Channels
   * ---------------------------------------------------------------- */

  private createChannelNodes(state: ChannelState): ChannelNodes {
    const ctx = this.ensure();
    const gain = ctx.createGain();
    gain.gain.value = faderToGain(state.gain);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    gain.connect(analyser);
    analyser.connect(this.programBus!);
    return { state, gain, analyser, buffer: new Float32Array(analyser.fftSize) };
  }

  /**
   * Open a capture device and add it as a mixer channel. Resolves with the
   * channel state, including an `error` when the device could not be opened —
   * it never throws, so one bad device cannot take the mixer down.
   */
  async addInputChannel(options: {
    id: string;
    label: string;
    deviceId?: string;
    isVoice?: boolean;
    gain?: number;
  }): Promise<ChannelState> {
    this.removeChannel(options.id);
    const state: ChannelState = {
      id: options.id,
      label: options.label,
      kind: 'input',
      deviceId: options.deviceId,
      gain: options.gain ?? 0.75,
      muted: false,
      soloed: false,
      isVoice: options.isVoice ?? false,
      connected: false,
    };

    const nodes = this.createChannelNodes(state);
    this.channels.set(options.id, nodes);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
          // Teaching audio: keep the raw signal, let the mixer shape it.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      const ctx = this.ensure();
      const source = ctx.createMediaStreamSource(stream);
      source.connect(nodes.gain);
      nodes.source = source;
      nodes.stream = stream;
      state.connected = true;
      state.error = undefined;
    } catch (error) {
      state.connected = false;
      state.error = error instanceof Error ? error.message : 'Device unavailable';
    }
    return { ...state };
  }

  removeChannel(id: string): void {
    const nodes = this.channels.get(id);
    if (!nodes || nodes.state.kind === 'instrument') return;
    nodes.stream?.getTracks().forEach(track => track.stop());
    try {
      nodes.source?.disconnect();
      nodes.gain.disconnect();
      nodes.analyser.disconnect();
    } catch { /* already torn down */ }
    this.channels.delete(id);
  }

  listChannels(): ChannelState[] {
    return [...this.channels.values()].map(nodes => ({ ...nodes.state }));
  }

  setChannelGain(id: string, position: number): void {
    const nodes = this.channels.get(id);
    if (!nodes || !this.ctx) return;
    nodes.state.gain = Math.min(1, Math.max(0, position));
    this.applyChannelGain(nodes);
  }

  setChannelMuted(id: string, muted: boolean): void {
    const nodes = this.channels.get(id);
    if (!nodes) return;
    nodes.state.muted = muted;
    this.refreshAllGains();
  }

  setChannelSolo(id: string, soloed: boolean): void {
    const nodes = this.channels.get(id);
    if (!nodes) return;
    nodes.state.soloed = soloed;
    this.refreshAllGains();
  }

  setChannelVoice(id: string, isVoice: boolean): void {
    const nodes = this.channels.get(id);
    if (nodes) nodes.state.isVoice = isVoice;
  }

  private anySoloed(): boolean {
    return [...this.channels.values()].some(nodes => nodes.state.soloed);
  }

  private applyChannelGain(nodes: ChannelNodes): void {
    if (!this.ctx) return;
    const solo = this.anySoloed();
    const audible = !nodes.state.muted && (!solo || nodes.state.soloed);
    const target = audible ? faderToGain(nodes.state.gain) : 0;
    // Short ramp instead of a step, so mute/solo never clicks.
    nodes.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.012);
  }

  private refreshAllGains(): void {
    this.channels.forEach(nodes => this.applyChannelGain(nodes));
  }

  setMasterGain(position: number): void {
    if (!this.masterGain || !this.ctx) return;
    this.masterGain.gain.setTargetAtTime(faderToGain(position), this.ctx.currentTime, 0.012);
  }

  setMonitorGain(position: number): void {
    if (!this.monitorGain || !this.ctx) return;
    this.monitorGain.gain.setTargetAtTime(faderToGain(position), this.ctx.currentTime, 0.012);
  }

  setLimiterEnabled(enabled: boolean): void {
    if (!this.limiter) return;
    // Ratio 1:1 with a high threshold is a transparent bypass.
    this.limiter.threshold.value = enabled ? -1.5 : 0;
    this.limiter.ratio.value = enabled ? 20 : 1;
  }

  /** Route the speaker output to a specific device where the browser allows it. */
  async setOutputDevice(deviceId: string): Promise<boolean> {
    const element = this.sinkElement();
    if (!element || typeof (element as HTMLMediaElement & { setSinkId?: unknown }).setSinkId !== 'function') return false;
    try {
      if (!element.srcObject) {
        const ctx = this.ensure();
        const sink = ctx.createMediaStreamDestination();
        this.monitorGain?.disconnect();
        this.monitorGain?.connect(sink);
        element.srcObject = sink.stream;
        await element.play().catch(() => {});
      }
      await (element as HTMLMediaElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(deviceId);
      return true;
    } catch {
      return false;
    }
  }

  private sinkAudio?: HTMLAudioElement;
  private sinkElement(): HTMLAudioElement | undefined {
    if (typeof document === 'undefined') return undefined;
    if (!this.sinkAudio) {
      this.sinkAudio = document.createElement('audio');
      this.sinkAudio.autoplay = true;
      this.sinkAudio.style.display = 'none';
      document.body.appendChild(this.sinkAudio);
    }
    return this.sinkAudio;
  }

  /* ---------------------------------------------------------------- *
   * Metering
   * ---------------------------------------------------------------- */

  private measure(analyser: AnalyserNode, buffer: Float32Array): ChannelLevel {
    analyser.getFloatTimeDomainData(buffer as Float32Array<ArrayBuffer>);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < buffer.length; i++) {
      const sample = buffer[i];
      sum += sample * sample;
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }
    const rmsDb = toDb(Math.sqrt(sum / buffer.length));
    const peakDb = toDb(peak);
    return { rms: rmsDb, peak: peakDb, meter: dbToMeter(rmsDb), clipping: peak >= 0.999 };
  }

  /** Current level for every channel, keyed by channel id. */
  readLevels(): Record<string, ChannelLevel> {
    const out: Record<string, ChannelLevel> = {};
    if (!this.ctx) return out;
    this.channels.forEach((nodes, id) => {
      out[id] = this.measure(nodes.analyser, nodes.buffer);
    });
    if (this.masterAnalyser) out.master = this.measure(this.masterAnalyser, this.masterBuffer);
    return out;
  }

  /* ---------------------------------------------------------------- *
   * Ducking (sidechain from voice channels onto the program bus)
   * ---------------------------------------------------------------- */

  setDucking(options: { enabled?: boolean; amountDb?: number; thresholdDb?: number }): void {
    if (options.enabled !== undefined) this.duckingEnabled = options.enabled;
    if (options.amountDb !== undefined) this.duckAmountDb = options.amountDb;
    if (options.thresholdDb !== undefined) this.duckThresholdDb = options.thresholdDb;
    if (!this.duckingEnabled) this.applyDuck(1);
  }

  /**
   * Advance the ducking envelope. Call once per animation frame from the UI;
   * keeping it caller-driven avoids a second timer competing with React.
   */
  updateDucking(levels: Record<string, ChannelLevel>): number {
    if (!this.duckingEnabled || !this.ctx) return 1;
    let voicePeak = METER_FLOOR_DB;
    this.channels.forEach((nodes, id) => {
      if (!nodes.state.isVoice || nodes.state.muted) return;
      const level = levels[id];
      if (level && level.rms > voicePeak) voicePeak = level.rms;
    });
    const speaking = voicePeak > this.duckThresholdDb;
    const target = speaking ? Math.pow(10, this.duckAmountDb / 20) : 1;
    this.applyDuck(target, speaking ? 0.02 : 0.18);
    return target;
  }

  private applyDuck(target: number, timeConstant = 0.05): void {
    if (!this.duckGain || !this.ctx) return;
    this.duckGain.gain.setTargetAtTime(target, this.ctx.currentTime, timeConstant);
  }

  /* ---------------------------------------------------------------- *
   * Built-in instrument
   * ---------------------------------------------------------------- */

  subscribe(listener: (note: number, on: boolean, velocity: number) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(note: number, on: boolean, velocity: number): void {
    this.listeners.forEach(listener => {
      try { listener(note, on, velocity); } catch { /* a bad listener must not break playback */ }
    });
  }

  /**
   * Sound a note. `velocity` is 0..1 (MIDI velocity / 127).
   * Re-triggering a sounding note steals the voice without emitting a note-off.
   */
  noteOn(note: number, velocity = 0.7): void {
    const ctx = this.ensure();
    if (!this.synthChannel?.source) return;

    // Voice stealing: retire the old voice quickly, but do not report note-off.
    const existing = this.voices.get(note);
    if (existing) this.retireVoice(note, existing, 0.04);

    this.sustained.delete(note);

    const level = Math.max(0.02, Math.min(1, velocity));
    const frequency = frequencyOf(note, this.concertPitch);
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    // Higher notes decay faster, as on a real piano.
    const decay = Math.max(0.6, 3.2 - (note - 21) * 0.022);
    const peak = level * 0.28;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.34), now + 0.28);
    gain.gain.exponentialRampToValueAtTime(0.0002, now + decay);

    // Harder strikes bring out more upper partials.
    const partials: Array<[number, number, OscillatorType]> = [
      [1, 1, 'triangle'],
      [2, 0.16 + level * 0.16, 'sine'],
      [3, 0.06 + level * 0.09, 'sine'],
      [4, 0.02 + level * 0.05, 'sine'],
    ];
    const oscillators = partials.map(([ratio, amplitude, type]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      // Slight inharmonicity, as with real strings.
      osc.frequency.value = frequency * ratio * (1 + (ratio - 1) * 0.0008);
      const partialGain = ctx.createGain();
      partialGain.gain.value = amplitude;
      osc.connect(partialGain);
      partialGain.connect(gain);
      osc.start(now);
      return osc;
    });

    gain.connect(this.synthChannel.source);
    this.voices.set(note, { oscillators, gain, released: false });
    this.emit(note, true, level);
  }

  /** Release a note. Honours the sustain pedal. */
  noteOff(note: number): void {
    const voice = this.voices.get(note);
    if (!voice) return;
    if (this.sustainPedal) {
      this.sustained.add(note);
      voice.released = true;
      this.emit(note, false, 0);
      return;
    }
    this.retireVoice(note, voice, 0.22);
    this.emit(note, false, 0);
  }

  private retireVoice(
    note: number,
    voice: { oscillators: OscillatorNode[]; gain: GainNode },
    releaseSeconds: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const param = voice.gain.gain;
    // cancelAndHoldAtTime keeps the current value instead of snapping back to
    // the last scheduled point, which is what produces release clicks.
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
    else param.cancelScheduledValues(now);
    param.setTargetAtTime(0.0001, now, releaseSeconds / 3);

    const stopAt = now + releaseSeconds + 0.1;
    voice.oscillators.forEach(osc => {
      try { osc.stop(stopAt); } catch { /* already stopped */ }
      osc.onended = () => { try { osc.disconnect(); } catch { /* noop */ } };
    });
    // Release the gain node once the tail has finished, so voices do not leak.
    window.setTimeout(() => { try { voice.gain.disconnect(); } catch { /* noop */ } }, (releaseSeconds + 0.3) * 1000);
    this.voices.delete(note);
    this.sustained.delete(note);
  }

  /** MIDI CC 64. Holding the pedal defers releases until it lifts. */
  setSustain(down: boolean): void {
    this.sustainPedal = down;
    if (down) return;
    [...this.sustained].forEach(note => {
      const voice = this.voices.get(note);
      if (voice) this.retireVoice(note, voice, 0.28);
    });
    this.sustained.clear();
  }

  get sustainDown(): boolean {
    return this.sustainPedal;
  }

  /** MIDI CC 123. Silences everything without tearing the graph down. */
  allNotesOff(): void {
    [...this.voices.entries()].forEach(([note, voice]) => {
      this.retireVoice(note, voice, 0.08);
      this.emit(note, false, 0);
    });
    this.voices.clear();
    this.sustained.clear();
  }

  get soundingNotes(): number[] {
    return [...this.voices.keys()].sort((a, b) => a - b);
  }
}

export const audioEngine = new AudioEngine();

// Dev-only handle for diagnostics in the browser console. Stripped from production builds.
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__pianoTutorEngine = audioEngine;
}
