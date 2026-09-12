/**
 * The acoustics behind the built-in piano.
 *
 * The old voice was four sine partials under one envelope, which is why it
 * sounded like an organ rather than a piano. What actually makes a piano note
 * recognisable, roughly in order of how much the ear cares:
 *
 *  1. The spectrum, and the notch the hammer puts in it. A hammer striking at
 *     one eighth of the string's length cannot excite the 8th, 16th or 24th
 *     partial, because those have a node exactly where it lands. That missing
 *     partial is a large part of why a piano is not a sawtooth.
 *  2. High partials dying away far sooner than low ones, so the tone darkens
 *     as it rings. A single fixed waveform cannot do this; a falling filter can.
 *  3. Double decay. Two or three strings per note are tuned very slightly
 *     apart. They start in phase and drain energy into the bridge quickly, then
 *     fall out of phase and hold on much longer, so the note has a fast initial
 *     drop and a long quiet tail.
 *  4. The knock of the hammer itself, which is noise, not tone.
 *  5. The beating between those slightly detuned strings.
 *  6. Inharmonicity: a real string is stiff, so its partials sit progressively
 *     sharp of whole-number multiples rather than exactly on them.
 *
 * These functions are the arithmetic for all of that. They are pure so the
 * curves can be checked without an audio context.
 */

/** Concert A, as an anchor for the whole keyboard. */
export const A4_MIDI = 69;

/** Frequency of a MIDI note under a given tuning. */
export const frequencyOfNote = (note: number, concertPitch = 440): number =>
  concertPitch * Math.pow(2, (note - A4_MIDI) / 12);

/**
 * Stiffness of the string, as the inharmonicity coefficient B.
 *
 * Partial n sits at n·f₀·√(1 + B·n²) rather than at n·f₀. B is smallest in the
 * middle of the keyboard, where strings are long and thin relative to their
 * pitch, and rises at both ends: the bass strings are thick and wound, and the
 * top strings are very short. The effect is what makes a piano sound stretched
 * rather than electronic, and it is why a tuner stretches the octaves.
 */
export function inharmonicityB(note: number): number {
  // Minimum around C3; both directions climb, the treble far more steeply.
  const fromCentre = note - 48;
  const base = fromCentre >= 0
    ? 0.00008 * Math.exp(fromCentre * 0.085)
    : 0.00008 * Math.exp(-fromCentre * 0.055);
  return Math.min(0.05, base);
}

/** Where partial n actually sounds, given the string's stiffness. */
export const partialFrequency = (fundamental: number, n: number, b: number): number =>
  fundamental * n * Math.sqrt(1 + b * n * n);

/**
 * Relative strength of partial n.
 *
 * Two things shape it. The overall roll-off, which is gentler for a hard blow
 * than a soft one — that is the whole difference between piano and forte, far
 * more than loudness alone. And the hammer's strike point, which silences the
 * partials that have a node where it hits.
 */
export function partialAmplitude(n: number, velocity: number, strikePoint = 0.125): number {
  if (n < 1) return 0;
  // A soft strike rolls off steeply; a hard one keeps the upper partials.
  const rolloff = 1.9 - velocity * 0.95;
  const comb = Math.abs(Math.sin(Math.PI * n * strikePoint));
  return Math.pow(n, -rolloff) * comb;
}

/**
 * How many partials are worth generating.
 *
 * Anything at or above half the sample rate would alias into an audible
 * whistle, so the count falls as the note rises; the top octave genuinely has
 * only a handful of partials in the audible band.
 */
export function partialCount(fundamental: number, sampleRate: number, limit = 48): number {
  if (fundamental <= 0) return 0;
  const nyquist = sampleRate / 2;
  return Math.max(1, Math.min(limit, Math.floor(nyquist / fundamental) - 1));
}

/**
 * The harmonic spectrum as real coefficients for a PeriodicWave.
 *
 * Index 0 is the DC term and must stay zero. One wave per note and dynamic is
 * far cheaper than one oscillator per partial, and the falling filter below
 * supplies the part a fixed waveform cannot.
 */
export function buildSpectrum(
  fundamental: number, velocity: number, sampleRate: number, limit = 48,
): Float32Array {
  const count = partialCount(fundamental, sampleRate, limit);
  const real = new Float32Array(count + 1);
  let peak = 0;
  for (let n = 1; n <= count; n += 1) {
    const amplitude = partialAmplitude(n, velocity);
    real[n] = amplitude;
    peak = Math.max(peak, amplitude);
  }
  // Normalise so a soft note and a loud one differ in level by the envelope
  // rather than by however the spectrum happened to sum.
  if (peak > 0) for (let n = 1; n <= count; n += 1) real[n] /= peak;
  return real;
}

/**
 * How long the fundamental takes to fade, in seconds.
 *
 * A bottom A rings for the best part of half a minute; the top C is gone in
 * under a second. The curve between them is roughly exponential in pitch.
 */
export function fundamentalDecay(note: number): number {
  const seconds = 26 * Math.exp(-(note - 21) * 0.041);
  return Math.max(0.45, Math.min(30, seconds));
}

/**
 * The fast first stage of the double decay.
 *
 * The strings of one note start in step and lose energy into the bridge
 * quickly, then drift apart and sustain for much longer. Without this a
 * synthesised piano has no attack shape at all: it just fades.
 */
export const initialDecay = (note: number): number =>
  Math.max(0.06, fundamentalDecay(note) * 0.055);

/** How much of the note survives the fast stage and goes on ringing. */
export const aftersoundLevel = (velocity: number): number => 0.22 + velocity * 0.1;

/**
 * Where the tone-shaping filter starts, in hertz.
 *
 * A hard blow opens it right up and a soft one keeps it dark, which is the
 * character difference between the two dynamics. It is set relative to the
 * note's own fundamental so the same touch sounds equally bright everywhere.
 */
export function initialBrightness(fundamental: number, velocity: number): number {
  const harmonics = 3 + Math.pow(velocity, 1.4) * 26;
  return Math.max(320, Math.min(16000, fundamental * harmonics));
}

/** Where it settles once the note has rung on. */
export const finalBrightness = (fundamental: number): number =>
  Math.max(220, Math.min(4200, fundamental * 3.2));

/**
 * How quickly the tone darkens, in seconds.
 *
 * Bass notes hold their upper partials noticeably longer than treble ones, so
 * this follows the note rather than being a fixed number.
 */
export const brightnessDecay = (note: number): number =>
  Math.max(0.12, 1.5 * Math.exp(-(note - 21) * 0.02));

/**
 * How long the damper takes to stop the string.
 *
 * Not instant, and not equal across the keyboard: bass dampers are heavy and
 * take longer to settle a thick string. The top octave and a half has no
 * dampers at all on a real piano, which is why those notes ring on.
 */
export function damperTime(note: number): number {
  if (note >= 93) return Math.min(2.4, fundamentalDecay(note));
  return Math.max(0.08, 0.42 - (note - 21) * 0.0042);
}

/**
 * Level of the hammer knock, which is noise rather than tone.
 *
 * It rises faster than loudness does, so a hard note sounds percussive as well
 * as loud. Without it the attack has no transient and every note sounds soft.
 */
export const hammerLevel = (velocity: number): number => Math.pow(velocity, 2.1) * 0.42;

/** The knock is a thud low down and a click at the top. */
export const hammerTone = (fundamental: number): number =>
  Math.max(700, Math.min(6500, fundamental * 7));

/** And it is very short, shorter still for a hard strike. */
export const hammerDecay = (velocity: number): number => 0.035 - velocity * 0.016;

/**
 * Detuning between the strings of one note, in cents.
 *
 * A tuner leaves a unison very slightly imperfect on purpose; it is what gives
 * a piano its shimmer. Bass notes have one or two thick strings and are tuned
 * closer, so the spread narrows going down.
 */
export const unisonDetune = (note: number): number =>
  Math.max(0.8, Math.min(4.2, 0.9 + (note - 21) * 0.032));

/**
 * Stereo position, from a listener's seat at the keyboard.
 *
 * Bass to the left, treble to the right, and gently: a piano is one instrument
 * a few feet wide, not an orchestra.
 */
export const notePan = (note: number): number =>
  Math.max(-0.42, Math.min(0.42, ((note - 60) / 48) * 0.42));

/**
 * Peak level of one note, before the mixer.
 *
 * Compensated across the keyboard because the ear is far less sensitive in the
 * bass: an even-sounding chord needs more energy down low.
 */
export function noteGain(note: number, velocity: number): number {
  const loudness = Math.pow(Math.max(0.02, Math.min(1, velocity)), 1.5);
  // Roughly the inverse of the ear's sensitivity across the keyboard.
  const tilt = 1 + Math.max(0, (60 - note)) * 0.006 - Math.max(0, (note - 84)) * 0.003;
  return loudness * 0.62 * Math.max(0.55, tilt);
}

/**
 * A room impulse response, built rather than loaded.
 *
 * Shipping an audio file would mean a download and a licence; noise shaped by
 * a decay curve is indistinguishable for this purpose. The early part is
 * sparse reflections, which is what tells the ear the size of the room, and
 * the tail is a smooth exponential fade.
 */
export function impulseResponse(
  sampleRate: number, seconds = 1.8, decay = 2.6,
): { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> } {
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const left = new Float32Array(new ArrayBuffer(length * 4));
  const right = new Float32Array(new ArrayBuffer(length * 4));
  // A fixed sequence, so the reverb is the same every time the app starts.
  let seed = 20250912;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  for (let i = 0; i < length; i += 1) {
    const t = i / length;
    const envelope = Math.pow(1 - t, decay);
    left[i] = random() * envelope;
    right[i] = random() * envelope;
  }

  // A few discrete early reflections, spaced unevenly so they do not ring.
  [0.0081, 0.0127, 0.0193, 0.0271, 0.0352].forEach((time, index) => {
    const at = Math.floor(time * sampleRate);
    if (at >= length) return;
    const level = 0.55 / (index + 1);
    left[at] += level;
    right[Math.min(length - 1, at + Math.floor(sampleRate * 0.0013))] += level * 0.85;
  });

  return { left, right };
}
