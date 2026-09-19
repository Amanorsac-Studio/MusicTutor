/**
 * Naming chords from sound as it plays, for the YouTube side of the Learn tab.
 *
 * A video cannot be analysed ahead of time the way an imported file can: there
 * is no file, only whatever is coming out of the speakers at this moment. So
 * this listens to the computer's own output and names what it hears, a moment
 * behind the music.
 *
 * What it captures goes to an analyser and nowhere else. It is deliberately not
 * a mixer input: the speakers already carry this sound, and feeding it back
 * into the mix would double it for the teacher and echo it into a recording.
 */

import { audioEngine } from './audioEngine';
import { dropGhosts, MODEL_RATE, transcribeChunk, warmUp, type RollNote } from './transcribe';
import {
  binMap, bestChord, BASS_BAND, HARMONY_BAND, type ChordQuality,
} from './chordTrack';

export type HeardChord = { root: number; quality: ChordQuality };

/**
 * Steadies a stream of chroma frames into a chord that can be read.
 *
 * Two things make raw frame-by-frame answers unusable: a single frame is too
 * short to hold a whole chord when the notes are spread in time, and the answer
 * flickers at every passing note. So the chroma is averaged with a memory of
 * about a second, and a new chord has to win several times running before it
 * replaces the one on screen.
 */
export class ChordSmoother {
  private harmony = new Float32Array(12);
  private bass = new Float32Array(12);
  private held: HeardChord | null = null;
  private candidate: HeardChord | null = null;
  private votes = 0;
  private quiet = 0;

  constructor(
    /** How much of the old picture survives each frame. */
    private readonly memory = 0.82,
    /** Frames in a row a new chord needs before it is shown. */
    private readonly confirm = 3,
    /** Frames of silence before the display clears. */
    private readonly release = 12,
  ) {}

  /** The averaged harmony, for anything that wants to draw it. */
  get chroma(): Float32Array {
    return this.harmony;
  }

  push(harmony: Float32Array, bass: Float32Array, loud: boolean): HeardChord | null {
    if (!loud) {
      this.quiet += 1;
      for (let i = 0; i < 12; i += 1) { this.harmony[i] *= this.memory; this.bass[i] *= this.memory; }
      if (this.quiet >= this.release) { this.held = null; this.candidate = null; this.votes = 0; }
      return this.held;
    }
    this.quiet = 0;
    for (let i = 0; i < 12; i += 1) {
      this.harmony[i] = this.harmony[i] * this.memory + harmony[i] * (1 - this.memory);
      this.bass[i] = this.bass[i] * this.memory + bass[i] * (1 - this.memory);
    }

    const best = bestChord(this.harmony, this.bass);
    if (!best) return this.held;
    const same = (a: HeardChord | null, b: HeardChord) => a?.root === b.root && a.quality === b.quality;
    if (same(this.held, best)) {
      this.candidate = null;
      this.votes = 0;
    } else if (same(this.candidate, best)) {
      this.votes += 1;
      if (this.votes >= this.confirm) {
        this.held = best;
        this.candidate = null;
        this.votes = 0;
      }
    } else {
      this.candidate = best;
      this.votes = 1;
    }
    return this.held;
  }

  reset(): void {
    this.harmony.fill(0);
    this.bass.fill(0);
    this.held = null;
    this.candidate = null;
    this.votes = 0;
    this.quiet = 0;
  }
}

/**
 * Stitches notes heard in overlapping stretches of sound into one running list.
 *
 * Live sound is transcribed a few seconds at a time, each stretch overlapping
 * the last, so most notes are reported more than once and a held note is
 * reported in pieces. A note seen before is updated rather than added; a note
 * already sounding when a stretch began only lengthens the one it continues.
 */
export class NoteStitcher {
  private list: RollNote[] = [];

  get notes(): RollNote[] {
    return this.list;
  }

  /**
   * `heard` are in seconds from `windowStart`. Notes starting within `edge`
   * of the stretch's beginning are treated as continuing, not as new attacks:
   * the network reports anything already sounding as starting there.
   */
  add(
    heard: Array<{ start: number; end: number; midi: number; velocity: number }>,
    windowStart: number, edge = 0.35,
  ): void {
    const next = [...this.list];
    heard.forEach(raw => {
      const note = { ...raw, start: raw.start + windowStart, end: raw.end + windowStart };
      const same = next.filter(item => item.midi === note.midi);
      const twin = same.find(item => Math.abs(item.start - note.start) <= 0.12);
      if (twin) {
        twin.end = Math.max(twin.end, note.end);
        twin.velocity = Math.max(twin.velocity, note.velocity);
        return;
      }
      if (raw.start < edge) {
        const held = same.find(item => item.start < note.start && item.end >= note.start - 0.15);
        if (held) held.end = Math.max(held.end, note.end);
        // With nothing to continue it is the tail of a note from before
        // listening began, and is not worth drawing.
        return;
      }
      // A fresh attack on a key still drawn as held ends the held one there.
      same.forEach(item => { if (item.start < note.start && item.end > note.start) item.end = note.start; });
      next.push({ ...note, melody: false });
    });
    next.sort((a, b) => a.start - b.start || a.midi - b.midi);
    this.list = next;
  }

  /** Forget what has scrolled away. */
  prune(before: number): void {
    if (this.list.length && this.list[0].end < before) this.list = this.list.filter(note => note.end >= before);
  }

  reset(): void {
    this.list = [];
  }
}

/** Mark the top line of live notes, the same skyline rule as for a file. */
const markTop = (notes: RollNote[]): RollNote[] => notes.map(note => ({
  ...note,
  melody: note.midi >= 55 && !notes.some(other =>
    other !== note && other.midi > note.midi && other.start <= note.start + 0.01 && other.end > note.start + 0.01),
}));

export type LiveListenState = {
  listening: boolean;
  chord: HeardChord | null;
  /** Notes heard, in seconds since listening began. */
  notes: RollNote[];
  error: string;
};

/** Seconds of sound handed to the network at a time. */
const NOTE_WINDOW = 4;
/**
 * How far behind the sound the roll runs.
 *
 * Notes cannot be drawn the instant they sound: the network needs to hear a
 * note ring for a moment to be sure of it, and then needs time to think. So
 * the roll runs this far behind, steadily, and every note has been found by
 * the time it reaches the line. A steady delay can be read; notes popping in
 * late at random cannot.
 */
export const LIVE_DELAY = 2.2;

const FFT_SIZE = 8192;
/** Below this the room is treated as silent. Analyser magnitudes, not samples. */
const SILENCE = 0.0006;

export class LiveListener {
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private timer = 0;
  private smoother = new ChordSmoother();
  private current: LiveListenState = { listening: false, chord: null, notes: [], error: '' };
  private tap?: ScriptProcessorNode;
  private sink?: GainNode;
  private ring = new Float32Array(0);
  private written = 0;
  private startedAt = 0;
  private noteTimer = 0;
  private thinking = false;
  private stitcher = new NoteStitcher();
  private stoppedAt = 0;
  private listeners = new Set<() => void>();

  get state(): LiveListenState {
    return this.current;
  }

  /** Where the roll's line is, in seconds since listening began. */
  get position(): number {
    const ctx = this.source?.context;
    // After stopping, the line stays where it was so the passage can be read.
    return ctx ? Math.max(0, ctx.currentTime - this.startedAt - LIVE_DELAY) : this.stoppedAt;
  }

  /** Hear the notes in the last few seconds, and stitch them in. */
  private async hearNotes(rate: number): Promise<void> {
    if (this.thinking || !this.current.listening) return;
    const want = Math.floor(NOTE_WINDOW * rate);
    if (this.written < rate) return;
    this.thinking = true;
    try {
      const length = Math.min(want, this.written, this.ring.length);
      const end = this.written;
      const chunk = new Float32Array(length);
      for (let i = 0; i < length; i += 1) chunk[i] = this.ring[(end - length + i) % this.ring.length];

      // Silence, a pause in the video, or room noise: nothing to find, and
      // looking would only invent something.
      let power = 0;
      for (let i = 0; i < length; i += 1) power += chunk[i] * chunk[i];
      if (Math.sqrt(power / length) < 0.004) return;

      const from = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: rate });
      from.copyToChannel(chunk, 0);
      const offline = new OfflineAudioContext(1, Math.ceil(length * MODEL_RATE / rate), MODEL_RATE);
      const node = offline.createBufferSource();
      node.buffer = from;
      node.connect(offline.destination);
      node.start();
      const audio = (await offline.startRendering()).getChannelData(0);

      const heard = (await transcribeChunk(audio))
        // Stricter than for a file: there is no second look at live sound, and
        // speech and applause both throw up faint, short false notes.
        .filter(note => note.velocity >= 0.22 && note.end - note.start >= 0.08 && note.midi >= 21 && note.midi <= 108)
        .map(note => ({ ...note, melody: false }));
      if (!this.current.listening) return;
      this.stitcher.add(dropGhosts(heard), (end - length) / rate);
      this.stitcher.prune(this.position - 20);
      this.set({ notes: markTop(this.stitcher.notes) });
    } catch {
      // One stretch that could not be read is not worth stopping for.
    } finally {
      this.thinking = false;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private set(next: Partial<LiveListenState>): void {
    this.current = { ...this.current, ...next };
    this.listeners.forEach(listener => listener());
  }

  async start(concertPitch = 440): Promise<void> {
    if (this.current.listening) return;
    this.set({ error: '' });
    // Started now so it is ready by the time there is something to hear.
    this.thinking = true;
    void warmUp().catch(() => { /* the first real stretch will try again */ }).finally(() => { this.thinking = false; });
    try {
      const media = navigator.mediaDevices as MediaDevices & {
        getDisplayMedia?: (constraints: unknown) => Promise<MediaStream>;
      };
      if (!media.getDisplayMedia) throw new Error('Listening to the computer needs the installed desktop app.');
      const stream = await media.getDisplayMedia({ video: true, audio: true });
      const audio = stream.getAudioTracks();
      // The picture was only ever a condition of the request.
      stream.getVideoTracks().forEach(track => track.stop());
      if (!audio.length) throw new Error('Windows did not share the system sound.');

      const ctx = audioEngine.ensure();
      this.stream = new MediaStream(audio);
      this.source = ctx.createMediaStreamSource(this.stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0;
      // Into the analyser and no further: see the note at the top of the file.
      this.source.connect(this.analyser);

      // The samples themselves, kept for a few seconds, for hearing the notes.
      const rate = ctx.sampleRate;
      this.ring = new Float32Array(Math.ceil(rate * (NOTE_WINDOW + 2)));
      this.written = 0;
      this.stitcher.reset();
      this.tap = ctx.createScriptProcessor(4096, 2, 1);
      this.tap.onaudioprocess = event => {
        const left = event.inputBuffer.getChannelData(0);
        const right = event.inputBuffer.numberOfChannels > 1 ? event.inputBuffer.getChannelData(1) : left;
        if (this.written === 0) this.startedAt = ctx.currentTime - left.length / rate;
        for (let i = 0; i < left.length; i += 1) {
          this.ring[this.written % this.ring.length] = (left[i] + right[i]) / 2;
          this.written += 1;
        }
      };
      // A processor only runs while it leads somewhere, so it leads to silence.
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.source.connect(this.tap);
      this.tap.connect(this.sink);
      this.sink.connect(ctx.destination);
      this.startedAt = ctx.currentTime;
      this.noteTimer = window.setInterval(() => { void this.hearNotes(rate); }, 700);

      const harmonyMap = binMap(ctx.sampleRate, FFT_SIZE, HARMONY_BAND, concertPitch);
      const bassMap = binMap(ctx.sampleRate, FFT_SIZE, BASS_BAND, concertPitch);
      const decibels = new Float32Array(FFT_SIZE / 2);
      const harmony = new Float32Array(12);
      const bass = new Float32Array(12);
      this.smoother.reset();

      this.timer = window.setInterval(() => {
        const analyser = this.analyser;
        if (!analyser) return;
        analyser.getFloatFrequencyData(decibels);
        harmony.fill(0);
        bass.fill(0);
        let total = 0;
        harmonyMap.forEach(({ bin, pitchClass, weight }) => {
          const magnitude = 10 ** (decibels[bin] / 20);
          harmony[pitchClass] += Math.sqrt(magnitude) * weight;
          total += magnitude;
        });
        bassMap.forEach(({ bin, pitchClass, weight }) => {
          bass[pitchClass] += Math.sqrt(10 ** (decibels[bin] / 20)) * weight;
        });
        const loud = Number.isFinite(total) && total / harmonyMap.length > SILENCE;
        const chord = this.smoother.push(harmony, bass, loud);
        const before = this.current.chord;
        if (chord?.root !== before?.root || chord?.quality !== before?.quality) this.set({ chord });
      }, 90);

      audio[0].addEventListener('ended', () => this.stop());
      this.set({ listening: true, chord: null, notes: [] });
    } catch (error) {
      this.stop();
      this.set({ error: error instanceof Error ? error.message : 'The computer\'s sound could not be heard.' });
    }
  }

  stop(): void {
    if (this.source) this.stoppedAt = this.position;
    window.clearInterval(this.timer);
    window.clearInterval(this.noteTimer);
    this.timer = 0;
    this.noteTimer = 0;
    if (this.tap) this.tap.onaudioprocess = null;
    try { this.tap?.disconnect(); this.sink?.disconnect(); } catch { /* never connected */ }
    this.tap = undefined;
    this.sink = undefined;
    try { this.source?.disconnect(); } catch { /* never connected */ }
    this.stream?.getTracks().forEach(track => track.stop());
    this.source = undefined;
    this.analyser = undefined;
    this.stream = undefined;
    this.smoother.reset();
    if (this.current.listening || this.current.chord) this.set({ listening: false, chord: null });
    // The notes stay on screen after stopping, so the last passage can be read.
  }
}

export const liveListener = new LiveListener();
