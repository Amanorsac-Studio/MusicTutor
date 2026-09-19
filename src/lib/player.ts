/**
 * Backing-track player.
 *
 * Built for practising to, which is a different job from playing music back.
 * What a teacher actually needs is to slow a passage down without it changing
 * key, loop four bars of it, drop the whole thing a tone to suit a voice, and
 * hear a click that lines up with the recording rather than with a guess.
 *
 * Two decisions shape everything here.
 *
 * The first is that changing speed renders the whole track rather than
 * processing it as it plays. Stretching audio well is not cheap, and doing it
 * in real time means cutting corners that are audible. Rendering once, in a
 * worker, costs a few seconds when the speed is changed and nothing at all
 * afterwards — and playback is then an ordinary buffer, so looping is seamless
 * and seeking is exact.
 *
 * The second is that positions are always in the original track's time, never
 * the stretched one. A loop set at 1:12 stays at 1:12 when the speed changes,
 * which is what anyone would expect and is not what falls out naturally.
 */

import { audioEngine } from './audioEngine';
import { beatLength, detectTempo, type TempoEstimate } from './tempo';
import { trackBeats, nearestBar, nearestBeat, type BeatGrid } from './beats';
import { peaksFor, renderPlan, type Peak } from './timeStretch';
import type { StretchRequest, StretchResponse } from './stretchWorker';

export type TrackInfo = {
  id: string;
  name: string;
  duration: number;
  sampleRate: number;
  tempo: TempoEstimate;
  /** Where the beats fall, for the grid, the metronome and snapping. */
  grid: BeatGrid;
  /** Waveform outline for drawing. */
  peaks: Peak[];
};

export type PlayerState = {
  track: TrackInfo | null;
  playing: boolean;
  position: number;
  speed: number;
  /** Transposition in semitones; the speed is unaffected by it. */
  semitones: number;
  /** Loop bounds in seconds of the original track; null loops the whole thing. */
  loop: { start: number; end: number } | null;
  looping: boolean;
  metronome: boolean;
  /** Beats of count-in before the track starts. */
  countIn: number;
  /** Beats to the bar, for the click running on its own. */
  beatsPerBar: number;
  /** Loudness of the click, separate from the track's own volume. */
  clickVolume: number;
  /** Whether the click reaches the recording and the stream. */
  clickToStream: boolean;
  /** True while a new speed or transposition is being rendered. */
  rendering: boolean;
  /** 0..1 while rendering. */
  renderProgress: number;
  bpm: number;
  volume: number;
};

/** How many peaks to keep. Enough for a wide window without wasting memory. */
const PEAK_BUCKETS = 1600;

export class TrackPlayer {
  /** The track as decoded, which is the reference for every position. */
  private source?: AudioBuffer;
  /** The track as rendered at the current speed and transposition. */
  private rendered?: AudioBuffer;
  private info: TrackInfo | null = null;

  private gain?: GainNode;
  private metronomeGain?: GainNode;
  private node?: AudioBufferSourceNode;

  private worker?: Worker;
  private renderId = 0;
  private rendering = false;
  private renderProgress = 0;

  private playing = false;
  private speed = 1;
  private semitones = 0;
  private rate = 1;
  private factor = 1;

  /** Context time and track time at the moment playback last started. */
  private startedAtContextTime = 0;
  private startedAtTrackTime = 0;
  private pausedAt = 0;

  private loopRange: { start: number; end: number } | null = null;
  private looping = true;
  private metronomeOn = false;
  private countIn = 0;
  /** Accent every this many clicks when keeping time on its own. */
  private beatsPerBar = 4;
  private metronomeTimer = 0;
  private bpmOverride: number | null = null;
  private volume = 0.8;
  private clickVolume = 0.5;
  /** Whether the click is part of the recording and the stream. */
  private clickToStream = false;

  private listeners = new Set<() => void>();

  /**
   * Which strips on the desk this player owns. Two players sharing a strip
   * would fight over one fader, so each names its own.
   */
  constructor(private readonly strips = {
    track: 'track', trackLabel: 'Backing track', click: 'click', clickLabel: 'Metronome',
  }) {}

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
      // Its own strip on the desk, so it has a fader, a meter and a mute like
      // every other source rather than being wired invisibly into the mix.
      audioEngine.connectToChannel(this.strips.track, this.gain, {
        label: this.strips.trackLabel, kind: 'track', gain: 0.8,
      });
    }
    if (!this.metronomeGain) {
      this.metronomeGain = ctx.createGain();
      this.metronomeGain.gain.value = this.clickVolume;
      this.routeMetronome();
    }
    return { ctx, gain: this.gain, metronome: this.metronomeGain };
  }

  /**
   * Send the click either into the mix or only to the speakers.
   *
   * A click in the recording is right when the lesson is a play-along and wrong
   * when it is a performance, so it is a choice rather than a fixed decision.
   */
  private routeMetronome(): void {
    const node = this.metronomeGain;
    if (!node) return;
    try { node.disconnect(); } catch { /* nothing attached yet */ }
    if (this.clickToStream) {
      audioEngine.connectToChannel(this.strips.click, node, {
        label: this.strips.clickLabel, kind: 'click', gain: 0.7,
      });
    } else {
      // Monitor only, so the strip would be a fader that does nothing.
      audioEngine.dropChannel(this.strips.click);
      audioEngine.connectMonitorOnly(node);
    }
  }

  /* ---------------------------------------------------------------- *
   * Loading
   * ---------------------------------------------------------------- */

  /** Decode a file, find its tempo and its beats, and outline its waveform. */
  async load(file: File): Promise<TrackInfo> {
    const ctx = audioEngine.ensure();
    const bytes = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);

    // Analyse one channel; a mix-down would only blur the transients.
    const mono = buffer.getChannelData(0);
    const tempo = detectTempo(mono, buffer.sampleRate);
    const grid = trackBeats(mono, buffer.sampleRate, tempo.bpm);
    const channels = Array.from(
      { length: buffer.numberOfChannels },
      (_, i) => buffer.getChannelData(i),
    );

    this.stop();
    this.source = buffer;
    this.rendered = buffer;
    this.speed = 1;
    this.semitones = 0;
    this.rate = 1;
    this.factor = 1;
    this.bpmOverride = null;
    this.loopRange = null;
    this.info = {
      id: `${file.name}-${Date.now().toString(36)}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      tempo,
      grid,
      peaks: peaksFor(channels, PEAK_BUCKETS),
    };
    this.notify();
    return this.info;
  }

  /** The decoded recording, for analysis that needs the samples themselves. */
  get audioBuffer(): AudioBuffer | undefined {
    return this.source;
  }

  /**
   * Load audio that is already decoded, such as a separated stem.
   *
   * Tempo and beats may be handed over from the song the stem came from: a bass
   * line on its own has the same beat as the band it was taken out of, and
   * detecting it again from a sparser signal could only do worse.
   */
  loadBuffer(buffer: AudioBuffer, name: string, known?: { tempo: TempoEstimate; grid: BeatGrid }): TrackInfo {
    const mono = buffer.getChannelData(0);
    const tempo = known?.tempo ?? detectTempo(mono, buffer.sampleRate);
    const grid = known?.grid ?? trackBeats(mono, buffer.sampleRate, tempo.bpm);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const keepSpeed = this.speed;
    const keepSemitones = this.semitones;
    const at = this.position;
    this.stop();
    this.source = buffer;
    this.rendered = buffer;
    this.rate = 1;
    this.factor = 1;
    this.speed = 1;
    this.semitones = 0;
    this.bpmOverride = null;
    this.info = {
      id: `${name}-${Date.now().toString(36)}`,
      name,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      tempo, grid,
      peaks: peaksFor(channels, PEAK_BUCKETS),
    };
    this.pausedAt = Math.min(at, buffer.duration);
    this.notify();
    // Carry the practice settings over, so switching stems mid-loop at 70%
    // does not snap back to full speed.
    if (keepSpeed !== 1) this.setSpeed(keepSpeed);
    if (keepSemitones !== 0) this.setSemitones(keepSemitones);
    return this.info;
  }

  unload(): void {
    this.stop();
    this.source = undefined;
    this.rendered = undefined;
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
      semitones: this.semitones,
      loop: this.loopRange,
      looping: this.looping,
      metronome: this.metronomeOn,
      clickVolume: this.clickVolume,
      clickToStream: this.clickToStream,
      countIn: this.countIn,
      beatsPerBar: this.beatsPerBar,
      rendering: this.rendering,
      renderProgress: this.renderProgress,
      bpm: this.bpm,
      volume: this.volume,
    };
  }

  get bpm(): number {
    return this.bpmOverride ?? this.info?.tempo.bpm ?? 120;
  }

  /** Where the playhead is, in the original track's own time. */
  get position(): number {
    if (!this.playing || !this.source) return this.pausedAt;
    const ctx = audioEngine.context;
    if (!ctx) return this.pausedAt;
    // Original time advances at the chosen speed, whatever the render did.
    const elapsed = (ctx.currentTime - this.startedAtContextTime) * this.speed;
    const raw = this.startedAtTrackTime + elapsed;
    const { start, end } = this.bounds();
    if (!this.looping) return Math.min(raw, end);
    const span = Math.max(0.05, end - start);
    return start + ((raw - start) % span + span) % span;
  }

  /** Loop bounds, in original time, clamped to the track. */
  private bounds(): { start: number; end: number } {
    const duration = this.source?.duration ?? 0;
    if (!this.loopRange) return { start: 0, end: duration };
    return {
      start: Math.max(0, Math.min(this.loopRange.start, duration)),
      end: Math.min(duration, Math.max(this.loopRange.start + 0.1, this.loopRange.end)),
    };
  }

  play(): void {
    if (!this.source || this.playing) return;
    void audioEngine.resume();
    this.startAt(this.pausedAt);
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedAt = this.position;
    this.stopNode();
    this.playing = false;
    // The click carries on by itself; only the track has stopped.
    if (this.metronomeOn) this.startMetronome();
    else this.stopMetronome();
    this.notify();
  }

  stop(): void {
    this.stopNode();
    this.playing = false;
    this.pausedAt = this.bounds().start;
    if (this.metronomeOn) this.startMetronome();
    else this.stopMetronome();
    this.notify();
  }

  seek(seconds: number): void {
    const { start, end } = this.bounds();
    const at = Math.max(start, Math.min(end, seconds));
    this.pausedAt = at;
    if (this.playing) {
      this.stopNode();
      this.startAt(at);
    } else {
      this.notify();
    }
  }

  /**
   * Start the rendered buffer at a position given in original time.
   *
   * The rendered buffer runs on its own clock — a track stretched to 140% is
   * half as long again — so the position has to be converted on the way in.
   */
  private startAt(trackTime: number): void {
    const buffer = this.rendered;
    if (!buffer) return;
    const { ctx, gain } = this.nodes();
    const { start, end } = this.bounds();

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = this.rate;

    if (this.looping) {
      node.loop = true;
      node.loopStart = start * this.factor;
      node.loopEnd = end * this.factor;
    } else {
      node.onended = () => {
        // Reaching the end of a track that is not looping simply stops it.
        if (this.playing && this.node === node) this.pause();
      };
    }

    node.connect(gain);
    const countInSeconds = this.countIn > 0 ? this.countIn * beatLength(this.bpm) : 0;
    const startAt = ctx.currentTime + countInSeconds;
    node.start(startAt, trackTime * this.factor);

    this.node = node;
    this.playing = true;
    this.startedAtContextTime = startAt;
    this.startedAtTrackTime = trackTime;
    if (countInSeconds > 0) this.tickCountIn(ctx, startAt);
    // Switching from keeping its own time to following the track.
    if (this.metronomeOn) this.startMetronome();
    this.notify();
  }

  private stopNode(): void {
    if (!this.node) return;
    try { this.node.onended = null; this.node.stop(); } catch { /* already stopped */ }
    try { this.node.disconnect(); } catch { /* already gone */ }
    this.node = undefined;
  }

  /* ---------------------------------------------------------------- *
   * Speed and transposition
   * ---------------------------------------------------------------- */

  setSpeed(value: number): void {
    const next = Math.max(0.25, Math.min(2, value));
    if (Math.abs(next - this.speed) < 1e-6) return;
    this.speed = next;
    void this.render();
  }

  /**
   * Nudge the transposition.
   *
   * Relative rather than absolute because the caller is a button, and two quick
   * presses both read the same value if each has to work out the new one from a
   * copy of the state that React has not refreshed yet.
   */
  transposeBy(delta: number): void {
    this.setSemitones(this.semitones + delta);
  }

  /** Transpose without changing the speed. */
  setSemitones(value: number): void {
    const next = Math.max(-12, Math.min(12, Math.round(value)));
    if (next === this.semitones) return;
    this.semitones = next;
    void this.render();
  }

  /**
   * Re-render the track for the current speed and transposition.
   *
   * Playback carries on at the old setting until the new render lands, so
   * dragging a speed slider does not stutter. A render that is superseded is
   * simply thrown away when it arrives.
   */
  private async render(): Promise<void> {
    const source = this.source;
    if (!source) return;
    const plan = renderPlan(this.speed, this.semitones);

    // Nothing to resynthesise: play the decoded audio and set the rate.
    if (Math.abs(plan.factor - 1) < 1e-6) {
      this.applyRender(source, plan.factor, plan.rate);
      return;
    }

    const id = ++this.renderId;
    this.rendering = true;
    this.renderProgress = 0;
    this.notify();

    const channels = Array.from(
      { length: source.numberOfChannels },
      (_, i) => Float32Array.from(source.getChannelData(i)),
    );

    try {
      const out = await this.runWorker(id, channels, plan.factor);
      if (id !== this.renderId) return; // Superseded by a later change.
      const ctx = audioEngine.ensure();
      const buffer = ctx.createBuffer(out.length, out[0].length, source.sampleRate);
      out.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
      this.applyRender(buffer, plan.factor, plan.rate);
    } catch {
      // A failed render leaves the previous one playing, which is the least
      // disruptive outcome; the speed control simply appears not to take.
      if (id === this.renderId) {
        this.rendering = false;
        this.notify();
      }
    }
  }

  private runWorker(id: number, channels: Float32Array[], factor: number): Promise<Float32Array[]> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./stretchWorker.ts', import.meta.url), { type: 'module' });
    }
    const worker = this.worker;

    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<StretchResponse>) => {
        const message = event.data;
        if (message.id !== id) return;
        if (message.kind === 'progress') {
          this.renderProgress = message.fraction;
          this.notify();
          return;
        }
        worker.removeEventListener('message', onMessage);
        if (message.kind === 'done') resolve(message.channels);
        else reject(new Error(message.message));
      };
      worker.addEventListener('message', onMessage);
      const request: StretchRequest = { id, channels, factor };
      worker.postMessage(request, channels.map(c => c.buffer) as Transferable[]);
    });
  }

  /** Swap in a freshly rendered buffer, keeping the playhead where it was. */
  private applyRender(buffer: AudioBuffer, factor: number, rate: number): void {
    const at = this.position;
    const wasPlaying = this.playing;
    this.stopNode();
    this.rendered = buffer;
    this.factor = factor;
    this.rate = rate;
    this.rendering = false;
    this.renderProgress = 1;
    this.pausedAt = at;
    if (wasPlaying) this.startAt(at);
    else {
      this.playing = false;
      this.notify();
    }
  }

  /* ---------------------------------------------------------------- *
   * Looping
   * ---------------------------------------------------------------- */

  setLoop(range: { start: number; end: number } | null): void {
    this.loopRange = range;
    if (this.playing) this.seek(Math.max(this.position, range?.start ?? 0));
    else this.notify();
  }

  setLooping(value: boolean): void {
    this.looping = value;
    if (this.playing) this.seek(this.position);
    else this.notify();
  }

  /**
   * Loop a number of bars from a moment, snapped to where the bars actually
   * start — which is the point of tracking beats rather than only tempo.
   */
  loopBars(from: number, bars: number): void {
    const grid = this.info?.grid;
    const duration = this.source?.duration ?? 0;
    if (!grid || !grid.beats.length) {
      // No grid to snap to, so fall back to bars of the nominal tempo.
      const span = beatLength(this.bpm) * (grid?.beatsPerBar ?? 4);
      this.setLoop({ start: from, end: Math.min(duration, from + span * bars) });
      return;
    }
    const start = nearestBar(from, grid);
    const beatsAhead = bars * grid.beatsPerBar;
    const startIndex = grid.beats.indexOf(start);
    const endIndex = startIndex >= 0 ? startIndex + beatsAhead : -1;
    const end = endIndex >= 0 && endIndex < grid.beats.length
      ? grid.beats[endIndex]
      : Math.min(duration, start + beatLength(this.bpm) * beatsAhead);
    this.setLoop({ start, end });
  }

  /** Snap a moment to the nearest beat, for setting loop points by hand. */
  snap(time: number, toBar = false): number {
    const grid = this.info?.grid;
    if (!grid || !grid.beats.length) return time;
    return toBar ? nearestBar(time, grid) : nearestBeat(time, grid.beats);
  }

  /* ---------------------------------------------------------------- *
   * Metronome and count-in
   * ---------------------------------------------------------------- */

  /**
   * Switch the click on or off.
   *
   * It runs with or without a track. A teacher wanting a beat to practise
   * scales to should not have to import a song first, so with nothing loaded it
   * simply keeps time at the chosen tempo.
   */
  setMetronome(value: boolean): void {
    this.metronomeOn = value;
    if (value) this.startMetronome();
    else this.stopMetronome();
    this.notify();
  }

  /** How many beats to the bar when the click is running on its own. */
  setBeatsPerBar(value: number): void {
    this.beatsPerBar = Math.max(1, Math.min(12, Math.round(value)));
    if (this.metronomeOn) this.startMetronome();
    this.notify();
  }

  setCountIn(beats: number): void {
    this.countIn = Math.max(0, Math.min(8, Math.round(beats)));
    this.notify();
  }

  setBpm(value: number): void {
    this.bpmOverride = Math.max(30, Math.min(300, Math.round(value)));
    // A click already running has to pick up the new tempo, not finish the old.
    if (this.metronomeOn) this.startMetronome();
    this.notify();
  }

  setClickVolume(value: number): void {
    this.clickVolume = Math.max(0, Math.min(1, value));
    if (this.metronomeGain && audioEngine.context) {
      this.metronomeGain.gain.setTargetAtTime(this.clickVolume, audioEngine.context.currentTime, 0.02);
    }
    this.notify();
  }

  setClickToStream(value: boolean): void {
    if (value === this.clickToStream) return;
    this.clickToStream = value;
    this.routeMetronome();
    this.notify();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.gain && audioEngine.context) {
      this.gain.gain.setTargetAtTime(this.volume, audioEngine.context.currentTime, 0.02);
    }
    this.notify();
  }

  /** A short click. Accented ones mark the first beat of the bar. */
  private click(at: number, accent: boolean): void {
    const { ctx, metronome } = this.nodes();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, at + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(gain);
    gain.connect(metronome);
    osc.start(at);
    osc.stop(at + 0.08);
    osc.onended = () => { try { gain.disconnect(); } catch { /* noop */ } };
  }

  /** Click the count-in, which happens before the track starts. */
  private tickCountIn(ctx: AudioContext, startAt: number): void {
    const beat = beatLength(this.bpm);
    for (let i = 0; i < this.countIn; i += 1) {
      this.click(startAt - (this.countIn - i) * beat, i === 0);
    }
  }

  /**
   * Schedule clicks on the tracked beats.
   *
   * Using the grid rather than a fixed interval is what keeps the click with
   * the music: a track that was recorded to a human performance drifts, and a
   * metronome running off the average tempo walks away from it within a minute.
   */
  private startMetronome(): void {
    this.stopMetronome();
    if (!this.metronomeOn) return;
    void audioEngine.resume();
    // Build the nodes now, so the first click is not late while the graph is
    // assembled underneath it.
    this.nodes();
    if (this.playing && this.info?.grid.beats.length) this.followTrack();
    else this.freeRun();
  }

  /**
   * Click along with the track's own beats.
   *
   * Using the grid rather than a fixed interval is what keeps the click with
   * the music: a track played by a person drifts, and a metronome running off
   * the average tempo walks away from it within a minute.
   */
  private followTrack(): void {
    const ctx = audioEngine.context;
    const grid = this.info?.grid;
    if (!ctx || !grid) return;

    const lookahead = 0.4;
    let scheduledTo = 0;

    const pump = () => {
      if (!this.playing || !this.metronomeOn) return;
      const now = this.position;
      const until = now + lookahead * this.speed;

      grid.beats.forEach((beat, index) => {
        if (beat <= Math.max(now, scheduledTo) || beat > until) return;
        // Track time to wall-clock: the gap shrinks as the speed rises.
        const at = ctx.currentTime + (beat - now) / this.speed;
        const downbeat = grid.beatsPerBar > 1
          && (index - grid.firstDownbeat) % grid.beatsPerBar === 0;
        this.click(at, downbeat);
      });
      scheduledTo = until;
      this.metronomeTimer = window.setTimeout(pump, (lookahead / 2) * 1000);
    };
    pump();
  }

  /**
   * Keep time on its own, with no track involved.
   *
   * Clicks are scheduled a little ahead on the audio clock rather than fired by
   * a timer, because a timer in a browser drifts and stutters, and a metronome
   * that does either is worse than none.
   */
  private freeRun(): void {
    const ctx = audioEngine.context;
    if (!ctx) return;
    const lookahead = 0.4;
    let nextBeat = ctx.currentTime + 0.12;
    let count = 0;

    const pump = () => {
      if (!this.metronomeOn) return;
      // The track taking over is handled by whoever starts playback.
      if (this.playing && this.info?.grid.beats.length) { this.followTrack(); return; }
      const beat = beatLength(this.bpm);
      const until = ctx.currentTime + lookahead;
      while (nextBeat < until) {
        this.click(nextBeat, this.beatsPerBar > 1 && count % this.beatsPerBar === 0);
        nextBeat += beat;
        count += 1;
      }
      this.metronomeTimer = window.setTimeout(pump, (lookahead / 2) * 1000);
    };
    pump();
  }

  private stopMetronome(): void {
    if (this.metronomeTimer) window.clearTimeout(this.metronomeTimer);
    this.metronomeTimer = 0;
  }
}

export const trackPlayer = new TrackPlayer();

/**
 * A second player, for the Learn tab.
 *
 * Kept apart from the backing-track player on purpose: a teacher may have a
 * backing track cued for the lesson while studying a different song to teach,
 * and loading one must not throw the other away.
 */
export const learnPlayer = new TrackPlayer({
  track: 'learn', trackLabel: 'Song being learned', click: 'learn-click', clickLabel: 'Learn click',
});
