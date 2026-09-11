/**
 * Backing-track player and metronome.
 *
 * Speed changes preserve pitch. A plain playbackRate would transpose the track —
 * practising a piece at 70% speed a minor third flat is useless — so slowing
 * down uses overlap-add granular resynthesis: short grains are taken at the
 * original pitch and re-spaced in time.
 *
 * The player feeds the audio engine's programme bus, so a backing track is
 * heard by the teacher, included in the mix and captured in the recording.
 */

import { audioEngine } from './audioEngine';
import { beatLength, detectTempo, type TempoEstimate } from './tempo';

export type TrackInfo = {
  id: string;
  name: string;
  duration: number;
  sampleRate: number;
  tempo: TempoEstimate;
};

export type PlayerState = {
  track: TrackInfo | null;
  playing: boolean;
  position: number;
  speed: number;
  /** Loop bounds in seconds; null when looping the whole track. */
  loop: { start: number; end: number } | null;
  looping: boolean;
  metronome: boolean;
  /** Tempo in use, which may be overridden from the detected value. */
  bpm: number;
};

/**
 * Grain length for time stretching. Long enough to carry pitch down to the bass
 * register, short enough that the smearing stays unobtrusive.
 */
const GRAIN_SECONDS = 0.12;
const GRAIN_OVERLAP = 0.5;

export class TrackPlayer {
  private buffer?: AudioBuffer;
  private info: TrackInfo | null = null;
  private gain?: GainNode;
  private metronomeGain?: GainNode;

  /** Scheduled grains, so a stop can cancel everything cleanly. */
  private grains: AudioBufferSourceNode[] = [];
  /** Straight playback node, used whenever the speed is normal. */
  private direct?: AudioBufferSourceNode;
  private scheduleTimer = 0;
  private metronomeTimer = 0;

  private playing = false;
  private speed = 1;
  private startedAtContextTime = 0;
  private startedAtTrackTime = 0;
  private loopRange: { start: number; end: number } | null = null;
  private looping = true;
  private metronomeOn = false;
  private bpmOverride: number | null = null;
  private volume = 0.8;

  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    this.listeners.forEach(listener => {
      try { listener(); } catch { /* a bad listener must not stop playback */ }
    });
  }

  private nodes(): { ctx: AudioContext; gain: GainNode; metronome: GainNode } {
    const ctx = audioEngine.ensure();
    if (!this.gain) {
      this.gain = ctx.createGain();
      this.gain.gain.value = this.volume;
      // Into the programme bus, so the track is monitored, mixed and recorded.
      audioEngine.connectExternal(this.gain);
    }
    if (!this.metronomeGain) {
      this.metronomeGain = ctx.createGain();
      this.metronomeGain.gain.value = 0.5;
      audioEngine.connectExternal(this.metronomeGain);
    }
    return { ctx, gain: this.gain, metronome: this.metronomeGain };
  }

  /* ---------------------------------------------------------------- *
   * Loading
   * ---------------------------------------------------------------- */

  /** Decode a file and analyse its tempo. */
  async load(file: File): Promise<TrackInfo> {
    const ctx = audioEngine.ensure();
    const bytes = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);

    // Analyse one channel; a mix-down would only blur the transients.
    const tempo = detectTempo(buffer.getChannelData(0), buffer.sampleRate);

    this.stop();
    this.buffer = buffer;
    this.bpmOverride = null;
    this.loopRange = null;
    this.info = {
      id: `${file.name}-${Date.now().toString(36)}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      tempo,
    };
    this.notify();
    return this.info;
  }

  unload(): void {
    this.stop();
    this.buffer = undefined;
    this.info = null;
    this.notify();
  }

  /* ---------------------------------------------------------------- *
   * Transport
   * ---------------------------------------------------------------- */

  get state(): PlayerState {
    return {
      track: this.info,
      playing: this.playing,
      position: this.position,
      speed: this.speed,
      loop: this.loopRange,
      looping: this.looping,
      metronome: this.metronomeOn,
      bpm: this.bpm,
    };
  }

  get bpm(): number {
    return this.bpmOverride ?? this.info?.tempo.bpm ?? 120;
  }

  setBpm(value: number): void {
    this.bpmOverride = Math.min(300, Math.max(20, value));
    if (this.metronomeOn) this.restartMetronome();
    this.notify();
  }

  /** Current playhead in track seconds. */
  get position(): number {
    if (!this.playing || !this.buffer) return this.startedAtTrackTime;
    const ctx = audioEngine.context;
    if (!ctx) return this.startedAtTrackTime;
    const elapsed = (ctx.currentTime - this.startedAtContextTime) * this.speed;
    const raw = this.startedAtTrackTime + elapsed;
    const { start, end } = this.bounds();
    if (!this.looping) return Math.min(raw, end);
    const span = Math.max(0.05, end - start);
    return start + ((raw - start) % span + span) % span;
  }

  private bounds(): { start: number; end: number } {
    const duration = this.buffer?.duration ?? 0;
    if (!this.loopRange) return { start: 0, end: duration };
    return {
      start: Math.max(0, Math.min(this.loopRange.start, duration)),
      end: Math.min(duration, Math.max(this.loopRange.start + 0.1, this.loopRange.end)),
    };
  }

  play(from?: number): void {
    if (!this.buffer) return;
    const { ctx } = this.nodes();
    void ctx.resume();
    this.stopGrains();
    const { start, end } = this.bounds();
    this.startedAtTrackTime = Math.max(start, Math.min(from ?? this.position, end - 0.02));
    this.startedAtContextTime = ctx.currentTime;
    this.playing = true;

    if (this.usesGranular) {
      this.scheduleAhead();
      this.scheduleTimer = window.setInterval(() => this.scheduleAhead(), 60);
    } else {
      this.playDirect(this.startedAtTrackTime);
    }

    if (this.metronomeOn) this.restartMetronome();
    this.notify();
  }

  pause(): void {
    const at = this.position;
    this.stopGrains();
    this.playing = false;
    this.startedAtTrackTime = at;
    window.clearInterval(this.scheduleTimer);
    this.scheduleTimer = 0;
    this.stopMetronome();
    this.notify();
  }

  stop(): void {
    this.stopGrains();
    this.playing = false;
    this.startedAtTrackTime = this.bounds().start;
    window.clearInterval(this.scheduleTimer);
    this.scheduleTimer = 0;
    this.stopMetronome();
    this.notify();
  }

  seek(seconds: number): void {
    const { start, end } = this.bounds();
    const target = Math.max(start, Math.min(seconds, end));
    if (this.playing) this.play(target);
    else { this.startedAtTrackTime = target; this.notify(); }
  }

  /**
   * Playback speed. 1 is original; 0.5 is half speed at the same pitch.
   */
  setSpeed(value: number): void {
    const next = Math.min(2, Math.max(0.25, value));
    if (Math.abs(next - this.speed) < 0.001) return;
    const at = this.position;
    this.speed = next;
    if (this.playing) this.play(at);
    else this.notify();
  }

  setLoop(range: { start: number; end: number } | null): void {
    this.loopRange = range;
    if (this.playing) this.play(this.position);
    else this.notify();
  }

  setLooping(value: boolean): void {
    this.looping = value;
    this.notify();
  }

  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    if (this.gain) this.gain.gain.value = this.volume;
    this.notify();
  }

  /* ---------------------------------------------------------------- *
   * Granular time stretch
   * ---------------------------------------------------------------- */

  private nextGrainAt = 0;

  /**
   * Schedule grains a little ahead of the playhead.
   *
   * Each grain plays at rate 1 — original pitch — but grains are spaced by
   * `grain * speed` in output time, so the track advances faster or slower
   * without transposing. At speed 1 this reduces to ordinary playback.
   */
  private scheduleAhead(): void {
    if (!this.playing || !this.buffer) return;
    const { ctx, gain } = this.nodes();
    const horizon = ctx.currentTime + 0.3;
    const { start, end } = this.bounds();
    // Synthesis hop. Grains are twice this long, so consecutive grains overlap
    // by half.
    const step = GRAIN_SECONDS * (1 - GRAIN_OVERLAP);

    if (this.nextGrainAt < ctx.currentTime) this.nextGrainAt = ctx.currentTime + 0.02;

    while (this.nextGrainAt < horizon) {
      const outputElapsed = this.nextGrainAt - this.startedAtContextTime;
      let trackTime = this.startedAtTrackTime + outputElapsed * this.speed;

      if (trackTime >= end) {
        if (!this.looping) { this.pause(); return; }
        const span = Math.max(0.05, end - start);
        trackTime = start + ((trackTime - start) % span);
      }

      const source = ctx.createBufferSource();
      source.buffer = this.buffer;

      // A triangular window: up over the first half, down over the second, with
      // no flat top. At 50% overlap a pair of these sums to exactly one. A
      // window with a flat top does not — overlapping pairs exceed unity and
      // modulate the amplitude at the grain rate, which is audible as a wobble.
      const envelope = ctx.createGain();
      const half = GRAIN_SECONDS / 2;
      envelope.gain.setValueAtTime(0, this.nextGrainAt);
      envelope.gain.linearRampToValueAtTime(1, this.nextGrainAt + half);
      envelope.gain.linearRampToValueAtTime(0, this.nextGrainAt + GRAIN_SECONDS);

      source.connect(envelope);
      envelope.connect(gain);
      try {
        source.start(this.nextGrainAt, Math.max(0, trackTime), GRAIN_SECONDS);
      } catch {
        // A seek can leave a grain scheduled in the past; skip it.
      }
      source.onended = () => {
        this.grains = this.grains.filter(item => item !== source);
        try { envelope.disconnect(); } catch { /* already gone */ }
      };
      this.grains.push(source);

      this.nextGrainAt += step;
    }
  }

  /**
   * Play the buffer straight through, untouched.
   *
   * At normal speed there is nothing to stretch, so the track must not go
   * anywhere near the granular path: chopping audio into grains and overlapping
   * them can only degrade it. This is what a loaded track does by default.
   */
  private playDirect(from: number): void {
    if (!this.buffer) return;
    const { ctx, gain } = this.nodes();
    const { start, end } = this.bounds();

    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    if (this.looping) {
      source.loop = true;
      source.loopStart = start;
      source.loopEnd = end;
    }
    source.connect(gain);
    source.onended = () => {
      if (this.direct === source) {
        this.direct = undefined;
        // A non-looping track that reached the end simply stops.
        if (this.playing && !this.looping) this.pause();
      }
    };
    try {
      source.start(ctx.currentTime, Math.max(0, Math.min(from, end - 0.01)));
    } catch {
      return;
    }
    this.direct = source;
  }

  private get usesGranular(): boolean {
    return Math.abs(this.speed - 1) > 0.005;
  }

  private stopGrains(): void {
    if (this.direct) {
      const node = this.direct;
      this.direct = undefined;
      node.onended = null;
      try { node.stop(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already gone */ }
    }
    this.grains.forEach(source => {
      try { source.stop(); } catch { /* already stopped */ }
      try { source.disconnect(); } catch { /* already gone */ }
    });
    this.grains = [];
    this.nextGrainAt = 0;
  }

  /* ---------------------------------------------------------------- *
   * Metronome
   * ---------------------------------------------------------------- */

  setMetronome(on: boolean): void {
    this.metronomeOn = on;
    if (on) this.restartMetronome();
    else this.stopMetronome();
    this.notify();
  }

  private metronomeBeat = 0;
  private nextClickAt = 0;

  private restartMetronome(): void {
    this.stopMetronome();
    const { ctx } = this.nodes();
    void ctx.resume();
    this.metronomeBeat = 0;
    this.nextClickAt = ctx.currentTime + 0.05;
    this.metronomeTimer = window.setInterval(() => this.scheduleClicks(), 60);
    this.scheduleClicks();
  }

  private stopMetronome(): void {
    window.clearInterval(this.metronomeTimer);
    this.metronomeTimer = 0;
  }

  /** Click at the working tempo, accented on the downbeat of each bar. */
  private scheduleClicks(): void {
    if (!this.metronomeOn) return;
    const { ctx, metronome } = this.nodes();
    const horizon = ctx.currentTime + 0.3;
    // The metronome follows the heard tempo, so it stays with a slowed track.
    const interval = beatLength(this.bpm) / (this.playing ? this.speed : 1);

    while (this.nextClickAt < horizon) {
      const accent = this.metronomeBeat % 4 === 0;
      const osc = ctx.createOscillator();
      const envelope = ctx.createGain();
      osc.frequency.value = accent ? 1600 : 1100;
      envelope.gain.setValueAtTime(0, this.nextClickAt);
      envelope.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, this.nextClickAt + 0.002);
      envelope.gain.exponentialRampToValueAtTime(0.0001, this.nextClickAt + 0.05);
      osc.connect(envelope);
      envelope.connect(metronome);
      osc.start(this.nextClickAt);
      osc.stop(this.nextClickAt + 0.06);
      osc.onended = () => { try { envelope.disconnect(); } catch { /* noop */ } };

      this.metronomeBeat++;
      this.nextClickAt += interval;
    }
  }
}

export const trackPlayer = new TrackPlayer();
