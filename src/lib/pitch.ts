/**
 * Hearing which single note is being played.
 *
 * This is for instruments that play one note at a time — a bass first of all.
 * It is a different problem from chord detection, and an easier one, provided
 * two traps are avoided.
 *
 * The first trap is looking for the loudest frequency. On a bass the second
 * harmonic is routinely louder than the fundamental, especially through small
 * pickups and on the low strings, so the loudest peak names the note an octave
 * high. What identifies the note is the period at which the waveform repeats,
 * not which partial carries the most energy. This uses YIN, which measures
 * exactly that: how little the waveform differs from a copy of itself shifted
 * by each candidate period.
 *
 * The second trap is the window. A low B on a five-string is 31 Hz, a period of
 * 32 milliseconds, and no method can name a pitch from less than about two
 * periods of it. So the latency floor is set by physics at the bottom of the
 * instrument, and the design spends its effort keeping the rest as short as
 * possible: the signal is decimated first, since nothing above a few hundred
 * hertz matters for a bass fundamental, which makes the search twenty times
 * cheaper and lets it run forty times a second without touching the audio.
 */

/** Lowest note worth listening for: a little under the B of a five-string. */
export const MIN_FREQUENCY = 28;

/** Highest: past the top of a 24-fret G string, with room for harmonics. */
export const MAX_FREQUENCY = 420;

/** How sure YIN must be. Lower is stricter; this is the published default. */
export const YIN_THRESHOLD = 0.15;

/** Below this level there is only hum and finger noise, and no note. */
export const SILENCE_RMS = 0.008;

export type PitchReading = {
  frequency: number;
  /** 0..1, how cleanly periodic the signal was. */
  clarity: number;
  rms: number;
};

/** Root mean square of a block, as a level. */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/**
 * Reduce the sample rate by averaging blocks of samples.
 *
 * Averaging is a crude low-pass, and crude is enough: anything it lets through
 * above the new Nyquist is far quieter than the fundamental being sought, and
 * YIN is looking for repetition rather than for spectral detail.
 */
export function decimate(samples: Float32Array, factor: number): Float32Array {
  const step = Math.max(1, Math.floor(factor));
  if (step === 1) return samples;
  const out = new Float32Array(Math.floor(samples.length / step));
  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    for (let k = 0; k < step; k += 1) sum += samples[i * step + k];
    out[i] = sum / step;
  }
  return out;
}

/**
 * The pitch of a block of audio, or null when it has none.
 *
 * YIN in its standard form: the difference function, its cumulative mean
 * normalisation, the first dip under the threshold, then a parabola through
 * that dip for a period finer than one sample.
 */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  options: { minFrequency?: number; maxFrequency?: number; threshold?: number } = {},
): PitchReading | null {
  const level = rms(samples);
  if (level < SILENCE_RMS) return null;

  const minFrequency = options.minFrequency ?? MIN_FREQUENCY;
  const maxFrequency = options.maxFrequency ?? MAX_FREQUENCY;
  const threshold = options.threshold ?? YIN_THRESHOLD;

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const tauMax = Math.min(Math.floor(samples.length / 2), Math.ceil(sampleRate / minFrequency));
  if (tauMax <= tauMin) return null;
  const window = samples.length - tauMax;
  if (window < tauMin) return null;

  // How different the signal is from itself at each shift.
  const difference = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau += 1) {
    let sum = 0;
    for (let i = 0; i < window; i += 1) {
      const delta = samples[i] - samples[i + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  // Normalised by the running mean, which is what stops YIN choosing a very
  // short shift simply because short shifts always differ least.
  const normalised = new Float32Array(tauMax + 1);
  normalised[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau += 1) {
    running += difference[tau];
    normalised[tau] = running > 0 ? (difference[tau] * tau) / running : 1;
  }

  // The first dip under the threshold, followed down to its floor. Taking the
  // first rather than the deepest is what keeps the answer on the fundamental
  // instead of a multiple of its period.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t += 1) {
    if (normalised[t] < threshold) {
      while (t + 1 <= tauMax && normalised[t + 1] < normalised[t]) t += 1;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  // A parabola through the dip and its neighbours, for a fractional period.
  let refined = tau;
  if (tau > 1 && tau < tauMax) {
    const before = normalised[tau - 1];
    const at = normalised[tau];
    const after = normalised[tau + 1];
    const denominator = before - 2 * at + after;
    if (denominator !== 0) {
      const shift = (0.5 * (before - after)) / denominator;
      if (Math.abs(shift) <= 1) refined = tau + shift;
    }
  }

  return {
    frequency: sampleRate / refined,
    clarity: Math.max(0, Math.min(1, 1 - normalised[tau])),
    rms: level,
  };
}

/** A frequency as a MIDI note number, fractional. */
export const frequencyToMidi = (frequency: number, concertPitch = 440): number =>
  69 + 12 * Math.log2(frequency / concertPitch);

export type TrackedNote = {
  /** Nearest MIDI note. */
  midi: number;
  /** How far from that note, in cents, for a tuning readout. */
  cents: number;
  frequency: number;
  clarity: number;
};

/**
 * Turns a stream of pitch readings into notes a person can read.
 *
 * Raw readings flicker. The attack of a plucked string is noise for its first
 * few milliseconds, a finger sliding off one fret passes through every pitch on
 * the way, and a note dying away wobbles as it falls under the threshold. A
 * display that showed all of that would be unreadable.
 *
 * So a new note has to be read the same way twice running before it is shown,
 * which costs one frame of delay and removes nearly all the flicker. Going
 * quiet is treated differently from changing note: a held note is kept through
 * a brief dropout, because a note that flashes off and on mid-sustain is worse
 * than one that lingers a twentieth of a second too long.
 */
export class NoteTracker {
  private current: TrackedNote | null = null;
  private candidate = -1;
  private candidateCount = 0;
  private silentFrames = 0;

  constructor(
    /** Readings in a row needed before a new note is believed. */
    private readonly confirmFrames = 2,
    /** Silent readings in a row before a held note is let go. */
    private readonly releaseFrames = 3,
    private readonly concertPitch = 440,
  ) {}

  get note(): TrackedNote | null {
    return this.current;
  }

  reset(): void {
    this.current = null;
    this.candidate = -1;
    this.candidateCount = 0;
    this.silentFrames = 0;
  }

  update(reading: PitchReading | null): TrackedNote | null {
    if (!reading) {
      this.silentFrames += 1;
      this.candidate = -1;
      this.candidateCount = 0;
      if (this.silentFrames >= this.releaseFrames) this.current = null;
      return this.current;
    }
    this.silentFrames = 0;

    const exact = frequencyToMidi(reading.frequency, this.concertPitch);
    const midi = Math.round(exact);
    const tracked: TrackedNote = {
      midi,
      cents: Math.round((exact - midi) * 100),
      frequency: reading.frequency,
      clarity: reading.clarity,
    };

    // The same note as before: refresh the tuning readout and carry on.
    if (this.current && this.current.midi === midi) {
      this.current = tracked;
      this.candidate = -1;
      this.candidateCount = 0;
      return this.current;
    }

    if (midi === this.candidate) this.candidateCount += 1;
    else {
      this.candidate = midi;
      this.candidateCount = 1;
    }
    if (this.candidateCount >= this.confirmFrames) {
      this.current = tracked;
      this.candidate = -1;
      this.candidateCount = 0;
    }
    return this.current;
  }
}
