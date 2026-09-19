/**
 * Naming chords and the bass note from sound as it plays, for the YouTube side
 * of the Learn tab.
 *
 * A video cannot be analysed ahead of time the way an imported file can: there
 * is no file, only whatever is coming out of the speakers at this moment. So
 * this listens to the computer's own output and names what it hears.
 *
 * Two listeners run side by side, because a band decides a chord between two
 * players. One follows the bass line as a single note, the same way Bass mode
 * follows a real bass. The other hears the harmony above it. The chord shown is
 * the one that fits both, and everything on screen — the name, the keys, the
 * necks — is drawn from that one answer, so they can never disagree.
 *
 * What is captured goes to analysers and nowhere else. It is deliberately not
 * a mixer input: the speakers already carry this sound, and feeding it back
 * into the mix would double it for the teacher and echo it into a recording.
 */

import { audioEngine } from './audioEngine';
import { decimate, detectPitch, NoteTracker } from './pitch';
import {
  binMap, bestChord, BASS_BAND, CHORD_SHAPES, HARMONY_BAND, type ChordQuality,
} from './chordTrack';

export type HeardChord = {
  root: number;
  quality: ChordQuality;
  /** Pitch class of the bass when it is on a chord note other than the root. */
  bass?: number;
};

const sameChord = (a: HeardChord | null, b: HeardChord | null) =>
  a?.root === b?.root && a?.quality === b?.quality && a?.bass === b?.bass;

/**
 * Steadies a stream of chroma frames into a chord that can be read.
 *
 * Two things make raw frame-by-frame answers unusable: a single frame is too
 * short to hold a whole chord when the notes are spread in time, and the answer
 * flickers at every passing note. So the chroma is averaged with a short
 * memory, and a new chord has to win several times running before it replaces
 * the one on screen.
 *
 * When the bass note is known it is believed over the blur of low frequencies:
 * it is one clear note, and it is the strongest single clue to the chord.
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

  push(harmony: Float32Array, bass: Float32Array, loud: boolean, bassNote: number | null = null): HeardChord | null {
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

    let lows = this.bass;
    let weight = 0.16;
    if (bassNote !== null) {
      lows = new Float32Array(12);
      lows[((bassNote % 12) + 12) % 12] = 1;
      weight = 0.24;
    }
    const found = bestChord(this.harmony, lows, weight);
    if (!found) return this.held;
    const best: HeardChord = { ...found };
    if (bassNote !== null) {
      const pc = ((bassNote % 12) + 12) % 12;
      const interval = (pc - best.root + 12) % 12;
      if (interval !== 0 && CHORD_SHAPES[best.quality].includes(interval)) best.bass = pc;
    }

    if (sameChord(this.held, best)) {
      this.candidate = null;
      this.votes = 0;
    } else if (this.held && this.held.root === best.root && this.held.quality === best.quality) {
      // Same chord over a new bass note: nothing to be unsure about.
      this.held = best;
    } else if (sameChord(this.candidate, best)) {
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
  /** The bass note sounding now, as a MIDI note, or null. */
  bassNote: number | null;
  error: string;
};

/**
 * A long window, for the harmony. A third of a second is slow for a melody but
 * right for a chord, and it is what lets neighbouring low notes be told apart.
 */
const FFT_SIZE = 16384;
/** Samples of low-passed sound the bass follower looks at. About 170 ms. */
const BASS_SAMPLES = 8192;
/**
 * Below this the room is treated as silent. Analyser magnitudes, not samples.
 * The level was found with a window of 8192; a longer window spreads the same
 * sound over more bins, each holding less, so the mark moves with the size.
 */
const SILENCE = 0.0006 * (8192 / FFT_SIZE);

export class LiveListener {
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private lowpass?: BiquadFilterNode;
  private lowpass2?: BiquadFilterNode;
  private bassAnalyser?: AnalyserNode;
  private timer = 0;
  private smoother = new ChordSmoother();
  private tracker = new NoteTracker(3, 5);
  private current: LiveListenState = { listening: false, chord: null, bassNote: null, error: '' };
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
      // Into the analysers and no further: see the note at the top of the file.
      this.source.connect(this.analyser);

      // The bass follower hears only the bottom of the sound, so that the one
      // repeating shape left in it is the bass line's.
      this.lowpass = ctx.createBiquadFilter();
      this.lowpass.type = 'lowpass';
      // Low enough to leave out a pianist's left hand and the body of a guitar,
      // which would otherwise be followed instead of the bass under them.
      this.lowpass.frequency.value = 125;
      this.lowpass.Q.value = 0.7;
      this.lowpass2 = ctx.createBiquadFilter();
      this.lowpass2.type = 'lowpass';
      this.lowpass2.frequency.value = 125;
      this.lowpass2.Q.value = 0.7;
      this.bassAnalyser = ctx.createAnalyser();
      this.bassAnalyser.fftSize = BASS_SAMPLES;
      this.source.connect(this.lowpass);
      this.lowpass.connect(this.lowpass2);
      this.lowpass2.connect(this.bassAnalyser);

      const harmonyMap = binMap(ctx.sampleRate, FFT_SIZE, HARMONY_BAND, concertPitch);
      const bassMap = binMap(ctx.sampleRate, FFT_SIZE, BASS_BAND, concertPitch);
      const decibels = new Float32Array(FFT_SIZE / 2);
      const wave = new Float32Array(BASS_SAMPLES);
      const harmony = new Float32Array(12);
      const bass = new Float32Array(12);
      const slow = Math.max(1, Math.round(ctx.sampleRate / 12000));
      this.smoother.reset();
      this.tracker = new NoteTracker(3, 5, concertPitch);

      this.timer = window.setInterval(() => {
        const analyser = this.analyser;
        const bassAnalyser = this.bassAnalyser;
        if (!analyser || !bassAnalyser) return;

        bassAnalyser.getFloatTimeDomainData(wave);
        const reading = detectPitch(decimate(wave, slow), ctx.sampleRate / slow, {
          minFrequency: 30, maxFrequency: 140, threshold: 0.2,
        });
        const bassNote = this.tracker.update(reading)?.midi ?? null;

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
        const chord = this.smoother.push(harmony, bass, loud, bassNote);
        if (!sameChord(chord, this.current.chord) || bassNote !== this.current.bassNote) {
          this.set({ chord, bassNote });
        }
      }, 60);

      audio[0].addEventListener('ended', () => this.stop());
      this.set({ listening: true, chord: null, bassNote: null });
    } catch (error) {
      this.stop();
      this.set({ error: error instanceof Error ? error.message : 'The computer\'s sound could not be heard.' });
    }
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    try { this.source?.disconnect(); this.lowpass?.disconnect(); this.lowpass2?.disconnect(); } catch { /* never connected */ }
    this.stream?.getTracks().forEach(track => track.stop());
    this.source = undefined;
    this.analyser = undefined;
    this.lowpass = undefined;
    this.lowpass2 = undefined;
    this.bassAnalyser = undefined;
    this.stream = undefined;
    this.smoother.reset();
    this.tracker.reset();
    if (this.current.listening || this.current.chord || this.current.bassNote !== null) {
      this.set({ listening: false, chord: null, bassNote: null });
    }
  }
}

export const liveListener = new LiveListener();
