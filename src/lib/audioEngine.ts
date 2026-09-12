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
import {
  aftersoundLevel, brightnessDecay, buildSpectrum, damperTime, finalBrightness,
  fundamentalDecay, hammerDecay, hammerLevel, hammerTone, impulseResponse,
  initialBrightness, initialDecay, notePan, noteGain, unisonDetune,
} from './piano';

/**
 * Two seconds of noise, reused by every hammer strike.
 *
 * A fixed sequence rather than Math.random, so a note struck twice is not
 * suspiciously identical but the instrument is the same every session.
 */
function buildNoise(ctx: AudioContext): AudioBuffer {
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const channel = noise.getChannelData(0);
  let seed = 987654321;
  for (let i = 0; i < channel.length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    channel[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return noise;
}

/**
 * One sounding note.
 *
 * Everything the voice owns is held so it can be torn down cleanly: a leaked
 * oscillator keeps running and costs processing for the rest of the session.
 */
type Voice = {
  note: number;
  oscillators: OscillatorNode[];
  /** The hammer knock, which stops on its own well before the tone does. */
  hammer?: AudioBufferSourceNode;
  gain: GainNode;
  tone: BiquadFilterNode;
  pan: StereoPannerNode;
  released: boolean;
};

export const METER_FLOOR_DB = -60;

export type ChannelKind = 'input' | 'instrument' | 'track' | 'click' | 'master';

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
  /** What the device actually granted, for confirming input quality. */
  channelCount?: number;
  sampleRate?: number;
  trackLabel?: string;
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
  private voices = new Map<number, Voice>();
  /** One PeriodicWave per note and dynamic, reused rather than rebuilt. */
  private waveCache = new Map<string, PeriodicWave>();
  /** Shared noise for the hammer knock, generated once. */
  private noiseBuffer?: AudioBuffer;
  /** The room, and how much of the instrument is sent into it. */
  private reverb?: ConvolverNode;
  private reverbSend?: GainNode;
  /** Lifted by the sustain pedal: undamped strings ring sympathetically. */
  private pedalResonance?: GainNode;
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

  /**
   * Round-trip latency of the output path, in milliseconds.
   *
   * baseLatency is the graph's own buffering and outputLatency is what the
   * operating system and the device add after that. Together they are the delay
   * between a note being scheduled and the speaker moving. Input latency is
   * reported per channel, since it depends on the interface.
   */
  get outputLatencyMs(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const base = ctx.baseLatency ?? 0;
    const output = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    return Math.round((base + output) * 10000) / 10;
  }

  /** Capture latency reported by an attached input, in milliseconds. */
  inputLatencyMs(channelId: string): number {
    const track = this.channels.get(channelId)?.stream?.getAudioTracks()[0];
    // Capture latency is real and reported by Chrome, but it is not in the
    // standard MediaTrackSettings, so the type has to be widened by hand.
    const latency = (track?.getSettings?.() as { latency?: number } | undefined)?.latency;
    return typeof latency === 'number' ? Math.round(latency * 10000) / 10 : 0;
  }

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

    // The room the piano is standing in. A dry piano sounds like a toy, and
    // this is the single largest improvement per unit of processing. It is
    // optional, though: an environment without convolution should still play,
    // just without the space around the notes.
    try {
      this.buildRoom(ctx, synthInput);
    } catch {
      this.reverb = undefined;
      this.reverbSend = undefined;
      this.pedalResonance = undefined;
    }

    try {
      this.noiseBuffer = buildNoise(ctx);
    } catch {
      this.noiseBuffer = undefined;
    }

    return ctx;
  }

  /** The convolution reverb and its two sends, built on first use. */
  private buildRoom(ctx: AudioContext, output: AudioNode): void {
    const { left, right } = impulseResponse(ctx.sampleRate);
    const ir = ctx.createBuffer(2, left.length, ctx.sampleRate);
    ir.copyToChannel(left, 0);
    ir.copyToChannel(right, 1);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.14;
    this.pedalResonance = ctx.createGain();
    this.pedalResonance.gain.value = 0;
    this.reverbSend.connect(this.reverb);
    this.pedalResonance.connect(this.reverb);
    this.reverb.connect(output);
  }

  get context(): AudioContext | undefined {
    return this.ctx;
  }

  get isRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  /**
   * Attach an outside node to the programme bus, so whatever it plays is
   * monitored, mixed and recorded like any other source. Used by the backing
   * track player and its metronome.
   */
  connectExternal(node: AudioNode): void {
    this.ensure();
    if (this.programBus) node.connect(this.programBus);
  }

  /**
   * Attach an outside node to its own mixer strip.
   *
   * The backing track and the metronome used to be wired straight into the
   * programme bus, which meant no fader, no meter and no mute for either of
   * them. Giving each one a channel puts it on the desk with everything else.
   */
  connectToChannel(id: string, node: AudioNode, options: {
    label: string; kind?: ChannelKind; gain?: number;
  }): void {
    this.ensure();
    this.ensureChannel({ id, label: options.label, kind: options.kind, gain: options.gain });
    const nodes = this.channels.get(id);
    if (!nodes) return;
    node.connect(nodes.gain);
    nodes.state.connected = true;
    this.announceChannels();
  }

  /**
   * Capture whatever the computer is playing.
   *
   * This is the simple answer to getting a plug-in, a browser tab or any other
   * app into the lesson: nothing to install, nothing to route. Windows hands
   * back a loopback of the speaker output. The API insists on a video track
   * even when only sound is wanted, so the picture is dropped immediately.
   *
   * Resolves with the channel state, including an `error` when it could not be
   * opened. It never throws.
   */
  async captureDesktopAudio(id = 'desktop', label = 'Desktop audio'): Promise<ChannelState> {
    this.removeChannel(id);
    const state: ChannelState = {
      id, label, kind: 'input', gain: 0.75, muted: false, soloed: false,
      isVoice: false, connected: false,
    };
    const nodes = this.createChannelNodes(state);
    this.channels.set(id, nodes);

    try {
      const media = navigator.mediaDevices as MediaDevices & {
        getDisplayMedia?: (constraints: unknown) => Promise<MediaStream>;
      };
      if (!media.getDisplayMedia) throw new Error('Desktop audio needs the installed desktop app.');
      const stream = await media.getDisplayMedia({ video: true, audio: true });

      const audio = stream.getAudioTracks();
      if (!audio.length) {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('Windows did not share the system sound. Try again and tick "Share audio".');
      }
      // The picture was only ever a condition of the request.
      stream.getVideoTracks().forEach(track => track.stop());

      const ctx = this.ensure();
      const audioOnly = new MediaStream(audio);
      const source = ctx.createMediaStreamSource(audioOnly);
      source.connect(nodes.gain);
      nodes.source = source;
      nodes.stream = audioOnly;
      state.connected = true;
      state.error = undefined;
      const settings = audio[0].getSettings?.() ?? {};
      state.channelCount = settings.channelCount;
      state.sampleRate = settings.sampleRate ?? ctx.sampleRate;
      state.trackLabel = audio[0].label;
    } catch (error) {
      state.connected = false;
      state.error = error instanceof Error ? error.message : 'Desktop audio could not be captured.';
    }
    this.announceChannels();
    return { ...state };
  }

  /**
   * Tell the mixer the desk has changed.
   *
   * Strips used to be discovered only when the mixer itself did something, so a
   * channel added by the backing track appeared nowhere until the page was
   * revisited. Anything that adds or removes a strip says so here.
   */
  private channelListeners = new Set<() => void>();

  onChannelsChanged(listener: () => void): () => void {
    this.channelListeners.add(listener);
    return () => { this.channelListeners.delete(listener); };
  }

  private announceChannels(): void {
    this.channelListeners.forEach(listener => {
      try { listener(); } catch { /* a bad listener must not break the mixer */ }
    });
  }

  /**
   * Attach a node so it is heard but not recorded or streamed.
   *
   * This is the whole point of a click track that stays in the room: the
   * teacher needs to hear it, and the people watching do not. It goes past the
   * programme bus straight to the monitor path, so it reaches the speakers and
   * nothing else.
   */
  connectMonitorOnly(node: AudioNode): void {
    const ctx = this.ensure();
    if (this.monitorGain) node.connect(this.monitorGain);
    else node.connect(ctx.destination);
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
          // Every browser "cleanup" stage is off. These are tuned for speech on
          // a laptop mic and would wreck a line input from an audio interface or
          // a virtual cable carrying a sampler's output: noise suppression eats
          // reverb tails, and auto gain pumps on sustained chords.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // Ask for full-quality stereo. A mono mic simply reports one channel.
          channelCount: { ideal: 2 },
          sampleRate: { ideal: 48000 },
          sampleSize: { ideal: 24 },
          // Ask the driver for the smallest capture buffer it will give. Chrome
          // treats this as a hint, so it may be ignored; where it is honoured it
          // is worth several milliseconds of round trip. Not in the standard
          // constraint type, hence the cast at the end of the object.
          latency: { ideal: 0 },
        } as MediaTrackConstraints & { latency?: ConstrainDouble },
        video: false,
      });
      const ctx = this.ensure();
      const source = ctx.createMediaStreamSource(stream);
      source.connect(nodes.gain);
      nodes.source = source;
      nodes.stream = stream;
      state.connected = true;
      state.error = undefined;

      // Report what the device actually granted, so the Devices page can show
      // whether a line input really came in as 48 kHz stereo.
      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings?.() ?? {};
      state.channelCount = settings.channelCount;
      state.sampleRate = settings.sampleRate ?? ctx.sampleRate;
      state.trackLabel = track?.label;
    } catch (error) {
      state.connected = false;
      state.error = error instanceof Error ? error.message : 'Device unavailable';
    }
    return { ...state };
  }

  /**
   * Create a mixer channel with no device attached. The standard slots exist
   * from startup so the Mixer always shows a full desk, whether or not anything
   * is plugged in yet.
   */
  ensureChannel(options: {
    id: string; label: string; isVoice?: boolean; gain?: number; kind?: ChannelKind;
  }): ChannelState {
    const existing = this.channels.get(options.id);
    if (existing) return { ...existing.state };
    const state: ChannelState = {
      id: options.id,
      label: options.label,
      kind: options.kind ?? 'input',
      gain: options.gain ?? 0.75,
      muted: false,
      soloed: false,
      isVoice: options.isVoice ?? false,
      connected: false,
    };
    this.channels.set(options.id, this.createChannelNodes(state));
    return { ...state };
  }

  /** Take a strip off the desk entirely. */
  dropChannel(id: string): void {
    const nodes = this.channels.get(id);
    if (!nodes) return;
    try { nodes.gain.disconnect(); } catch { /* already detached */ }
    this.channels.delete(id);
    this.announceChannels();
  }

  /** Disconnect a channel's device but keep the strip on the desk. */
  clearChannelDevice(id: string): void {
    const nodes = this.channels.get(id);
    if (!nodes || nodes.state.kind !== 'input') return;
    nodes.stream?.getTracks().forEach(track => track.stop());
    try { nodes.source?.disconnect(); } catch { /* already detached */ }
    nodes.stream = undefined;
    nodes.source = undefined;
    nodes.state.connected = false;
    nodes.state.deviceId = undefined;
    nodes.state.error = undefined;
    nodes.state.channelCount = undefined;
    nodes.state.sampleRate = undefined;
    nodes.state.trackLabel = undefined;
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
   * The waveform for one note at one dynamic.
   *
   * Building a PeriodicWave is not cheap, and a note is played hundreds of
   * times in a lesson, so they are cached per note and per dynamic band. Eight
   * bands is finer than the ear can pick out in a legato line.
   */
  private waveFor(note: number, fundamental: number, velocity: number): PeriodicWave | undefined {
    const ctx = this.ctx;
    if (!ctx) return undefined;
    const band = Math.max(0, Math.min(7, Math.round(velocity * 7)));
    const key = `${note}:${band}`;
    const cached = this.waveCache.get(key);
    if (cached) return cached;

    const real = buildSpectrum(fundamental, band / 7, ctx.sampleRate);
    const wave = ctx.createPeriodicWave(real, new Float32Array(real.length), {
      disableNormalization: false,
    });
    // A whole keyboard at eight dynamics is bounded and small; no eviction
    // policy is needed, but the cap stops an unforeseen path growing it.
    if (this.waveCache.size < 800) this.waveCache.set(key, wave);
    return wave;
  }

  /**
   * Sound a note. `velocity` is 0..1 (MIDI velocity / 127).
   * Re-triggering a sounding note steals the voice without emitting a note-off.
   *
   * The voice is built from the acoustics in ./piano: a stiff-string spectrum
   * with the hammer's notch in it, two slightly detuned copies so the note
   * shimmers the way three real strings do, a filter that closes as the note
   * rings so the tone darkens, a two-stage envelope for the piano's fast drop
   * into a long tail, and a noise knock for the hammer.
   */
  noteOn(note: number, velocity = 0.7): void {
    const ctx = this.ensure();
    if (!this.synthChannel?.source) return;

    // Voice stealing: retire the old voice quickly, but do not report note-off.
    const existing = this.voices.get(note);
    if (existing) this.retireVoice(note, existing, 0.04);
    this.sustained.delete(note);

    const level = Math.max(0.02, Math.min(1, velocity));
    const fundamental = frequencyOf(note, this.concertPitch);
    const now = ctx.currentTime;
    const wave = this.waveFor(note, fundamental, level);
    if (!wave) return;

    /* ---- the tone ---- */

    // The filter is what makes the note darken as it decays. A fixed waveform
    // cannot lose its upper partials; a closing filter can.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 0.4;
    const openTo = initialBrightness(fundamental, level);
    tone.frequency.setValueAtTime(openTo, now);
    tone.frequency.setTargetAtTime(finalBrightness(fundamental), now, brightnessDecay(note));

    // Voicing: a real piano is not equally bright at both ends of an octave.
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = Math.min(2600, Math.max(180, fundamental * 2.4));
    body.Q.value = 0.8;
    body.gain.value = 2.2;

    const gain = ctx.createGain();
    const peak = noteGain(note, level);
    const tail = peak * aftersoundLevel(level);
    const full = fundamentalDecay(note);

    // Attack, then the fast first decay, then the long aftersound. The two
    // stages are the piano's signature: a synthesiser with one decay always
    // sounds like a synthesiser.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.0035);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, tail), now + initialDecay(note));
    gain.gain.exponentialRampToValueAtTime(0.0002, now + full);

    const pan = ctx.createStereoPanner();
    pan.pan.value = notePan(note);

    // Three strings per note in the middle of the keyboard, tuned very
    // slightly apart. Two oscillators is enough to hear the shimmer.
    const spread = unisonDetune(note);
    const oscillators = [0, spread, -spread * 0.72].map((cents, index) => {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = fundamental;
      osc.detune.value = cents;
      const stringGain = ctx.createGain();
      stringGain.gain.value = index === 0 ? 1 : 0.52;
      osc.connect(stringGain);
      stringGain.connect(tone);
      osc.start(now);
      return osc;
    });

    tone.connect(body);
    body.connect(gain);
    gain.connect(pan);
    pan.connect(this.synthChannel.source);
    if (this.reverbSend) pan.connect(this.reverbSend);

    /* ---- the hammer ---- */

    let hammer: AudioBufferSourceNode | undefined;
    if (this.noiseBuffer && level > 0.05) {
      hammer = ctx.createBufferSource();
      hammer.buffer = this.noiseBuffer;
      hammer.loop = true;
      // Start somewhere different each time, so repeated notes are not
      // identical the way a sampled transient would be.
      const offset = (note * 0.137 + level * 0.41) % 1.8;

      const knock = ctx.createBiquadFilter();
      knock.type = 'bandpass';
      knock.frequency.value = hammerTone(fundamental);
      knock.Q.value = 0.7;

      const knockGain = ctx.createGain();
      const decay = hammerDecay(level);
      knockGain.gain.setValueAtTime(0, now);
      knockGain.gain.linearRampToValueAtTime(hammerLevel(level) * peak * 3.2, now + 0.0012);
      knockGain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.008, decay));

      hammer.connect(knock);
      knock.connect(knockGain);
      knockGain.connect(pan);
      hammer.start(now, offset);
      hammer.stop(now + 0.25);
    }

    this.voices.set(note, {
      oscillators, hammer, gain, tone, pan, released: false, note,
    });
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
    // The damper is felt, not a switch, and it is slower on a thick string.
    this.retireVoice(note, voice, damperTime(note));
    this.emit(note, false, 0);
  }


  private retireVoice(note: number, voice: Voice, releaseSeconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const param = voice.gain.gain;
    // cancelAndHoldAtTime keeps the current value instead of snapping back to
    // the last scheduled point, which is what produces release clicks.
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
    else param.cancelScheduledValues(now);
    param.setTargetAtTime(0.0001, now, releaseSeconds / 3);

    // Close the filter as the note is damped, so a released note goes dull as
    // well as quiet — which is what a damper actually does to a string.
    voice.tone.frequency.setTargetAtTime(
      Math.max(200, voice.tone.frequency.value * 0.45), now, releaseSeconds / 2,
    );

    const stopAt = now + releaseSeconds + 0.1;
    voice.oscillators.forEach(osc => {
      try { osc.stop(stopAt); } catch { /* already stopped */ }
      osc.onended = () => { try { osc.disconnect(); } catch { /* noop */ } };
    });
    try { voice.hammer?.stop(now); } catch { /* already finished */ }
    // Release the nodes once the tail has gone, so voices do not accumulate.
    window.setTimeout(() => {
      [voice.gain, voice.tone, voice.pan].forEach(node => {
        try { node.disconnect(); } catch { /* noop */ }
      });
    }, (releaseSeconds + 0.3) * 1000);
    this.voices.delete(note);
    this.sustained.delete(note);
  }

  /** MIDI CC 64. Holding the pedal defers releases until it lifts. */
  setSustain(down: boolean): void {
    this.sustainPedal = down;
    // With the pedal down every string is free to ring in sympathy, which on a
    // real piano is heard as the whole instrument opening up rather than as
    // any particular note. A little extra room does the same job here.
    if (this.pedalResonance && this.ctx) {
      this.pedalResonance.gain.setTargetAtTime(down ? 0.1 : 0, this.ctx.currentTime, down ? 0.08 : 0.3);
    }
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
