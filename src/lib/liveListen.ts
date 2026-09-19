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

export type LiveListenState = {
  listening: boolean;
  chord: HeardChord | null;
  error: string;
};

const FFT_SIZE = 8192;
/** Below this the room is treated as silent. Analyser magnitudes, not samples. */
const SILENCE = 0.0006;

export class LiveListener {
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private timer = 0;
  private smoother = new ChordSmoother();
  private current: LiveListenState = { listening: false, chord: null, error: '' };
  private listeners = new Set<() => void>();

  get state(): LiveListenState {
    return this.current;
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
      this.set({ listening: true, chord: null });
    } catch (error) {
      this.stop();
      this.set({ error: error instanceof Error ? error.message : 'The computer\'s sound could not be heard.' });
    }
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    try { this.source?.disconnect(); } catch { /* never connected */ }
    this.stream?.getTracks().forEach(track => track.stop());
    this.source = undefined;
    this.analyser = undefined;
    this.stream = undefined;
    this.smoother.reset();
    if (this.current.listening || this.current.chord) this.set({ listening: false, chord: null });
  }
}

export const liveListener = new LiveListener();
