/**
 * Music theory core: note naming, chord detection, and harmonic analysis.
 *
 * Conventions follow international standards:
 *  - MIDI note numbers per the MIDI 1.0 Specification (note 60 = Middle C = C4,
 *    Scientific Pitch Notation, as used by MMA / IEC 61966).
 *  - A4 = MIDI 69 = 440 Hz (ISO 16:1975 concert pitch), tunable for ensembles
 *    that use a different reference (e.g. 442 Hz in much of continental Europe).
 */

export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/** ISO 16 concert pitch. */
export const DEFAULT_CONCERT_PITCH = 440;

export type Accidental = 'sharp' | 'flat';

/** Pitch class 0-11 for a MIDI note number. */
export const pitchClass = (midi: number): number => ((midi % 12) + 12) % 12;

/** Scientific Pitch Notation octave: MIDI 60 -> 4 (C4 = Middle C). */
export const octaveOf = (midi: number): number => Math.floor(midi / 12) - 1;

export function noteName(midi: number, accidental: Accidental = 'sharp'): string {
  const table = accidental === 'flat' ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  return table[pitchClass(midi)];
}

/** Full name with octave, e.g. 60 -> "C4". */
export function noteLabel(midi: number, accidental: Accidental = 'sharp'): string {
  return `${noteName(midi, accidental)}${octaveOf(midi)}`;
}

/** Equal-tempered frequency in Hz. */
export function frequencyOf(midi: number, concertPitch = DEFAULT_CONCERT_PITCH): number {
  return concertPitch * Math.pow(2, (midi - 69) / 12);
}

export const isBlackKey = (midi: number): boolean => [1, 3, 6, 8, 10].includes(pitchClass(midi));

/* ------------------------------------------------------------------ *
 * Intervals
 * ------------------------------------------------------------------ */

const INTERVAL_NAMES: Record<number, string> = {
  0: 'Unison', 1: 'Minor 2nd', 2: 'Major 2nd', 3: 'Minor 3rd', 4: 'Major 3rd',
  5: 'Perfect 4th', 6: 'Tritone', 7: 'Perfect 5th', 8: 'Minor 6th',
  9: 'Major 6th', 10: 'Minor 7th', 11: 'Major 7th',
};

export function intervalName(semitones: number): string {
  const octaves = Math.floor(semitones / 12);
  const base = INTERVAL_NAMES[semitones % 12] ?? 'Unknown';
  if (semitones === 12) return 'Octave';
  return octaves > 0 ? `${base} + ${octaves} oct` : base;
}

/* ------------------------------------------------------------------ *
 * Chord vocabulary
 *
 * `optional` lists intervals that may be omitted without penalty — pianists
 * routinely drop the 5th from extended voicings, and rootless left-hand
 * voicings are standard in jazz comping.
 * ------------------------------------------------------------------ */

export type ChordTemplate = {
  /** Suffix appended to the root, e.g. "m7" in "Dm7". */
  symbol: string;
  /** Spoken name for teaching, e.g. "minor 7th". */
  name: string;
  intervals: number[];
  optional?: number[];
  /** Lower rank = more common; breaks ties toward the everyday reading. */
  rank: number;
};

export const CHORD_TEMPLATES: ChordTemplate[] = [
  // Triads
  { symbol: '', name: 'major', intervals: [0, 4, 7], rank: 0 },
  { symbol: 'm', name: 'minor', intervals: [0, 3, 7], rank: 0 },
  { symbol: 'dim', name: 'diminished', intervals: [0, 3, 6], rank: 2 },
  { symbol: 'aug', name: 'augmented', intervals: [0, 4, 8], rank: 3 },
  { symbol: 'sus2', name: 'suspended 2nd', intervals: [0, 2, 7], rank: 2 },
  { symbol: 'sus4', name: 'suspended 4th', intervals: [0, 5, 7], rank: 2 },
  { symbol: '5', name: 'power chord', intervals: [0, 7], rank: 4 },

  // Sixths
  { symbol: '6', name: 'major 6th', intervals: [0, 4, 7, 9], optional: [7], rank: 2 },
  { symbol: 'm6', name: 'minor 6th', intervals: [0, 3, 7, 9], optional: [7], rank: 2 },
  { symbol: '6/9', name: 'six-nine', intervals: [0, 2, 4, 7, 9], optional: [7], rank: 4 },

  // Sevenths
  { symbol: 'maj7', name: 'major 7th', intervals: [0, 4, 7, 11], optional: [7], rank: 1 },
  { symbol: '7', name: 'dominant 7th', intervals: [0, 4, 7, 10], optional: [7], rank: 1 },
  { symbol: 'm7', name: 'minor 7th', intervals: [0, 3, 7, 10], optional: [7], rank: 1 },
  { symbol: 'mMaj7', name: 'minor-major 7th', intervals: [0, 3, 7, 11], optional: [7], rank: 5 },
  { symbol: 'm7b5', name: 'half-diminished 7th', intervals: [0, 3, 6, 10], rank: 3 },
  { symbol: 'dim7', name: 'diminished 7th', intervals: [0, 3, 6, 9], rank: 3 },
  { symbol: '7sus4', name: 'dominant 7th suspended 4th', intervals: [0, 5, 7, 10], rank: 3 },
  { symbol: 'aug7', name: 'augmented 7th', intervals: [0, 4, 8, 10], rank: 5 },
  { symbol: 'maj7#5', name: 'major 7th sharp 5', intervals: [0, 4, 8, 11], rank: 6 },
  { symbol: '7b5', name: 'dominant 7th flat 5', intervals: [0, 4, 6, 10], rank: 5 },

  // Added tones
  { symbol: 'add9', name: 'added 9th', intervals: [0, 2, 4, 7], rank: 3 },
  { symbol: 'madd9', name: 'minor added 9th', intervals: [0, 2, 3, 7], rank: 4 },
  { symbol: 'add11', name: 'added 11th', intervals: [0, 4, 5, 7], rank: 5 },

  // Ninths
  { symbol: '9', name: 'dominant 9th', intervals: [0, 2, 4, 7, 10], optional: [7], rank: 2 },
  { symbol: 'maj9', name: 'major 9th', intervals: [0, 2, 4, 7, 11], optional: [7], rank: 2 },
  { symbol: 'm9', name: 'minor 9th', intervals: [0, 2, 3, 7, 10], optional: [7], rank: 2 },
  { symbol: '7b9', name: 'dominant 7th flat 9', intervals: [0, 1, 4, 7, 10], optional: [7], rank: 4 },
  { symbol: '7#9', name: 'dominant 7th sharp 9', intervals: [0, 3, 4, 7, 10], optional: [7], rank: 4 },
  { symbol: '7#11', name: 'dominant 7th sharp 11', intervals: [0, 4, 6, 7, 10], optional: [7], rank: 5 },

  // Elevenths / thirteenths
  { symbol: '11', name: 'dominant 11th', intervals: [0, 2, 5, 7, 10], optional: [7], rank: 5 },
  { symbol: 'm11', name: 'minor 11th', intervals: [0, 2, 3, 5, 7, 10], optional: [7, 2], rank: 4 },
  { symbol: '13', name: 'dominant 13th', intervals: [0, 2, 4, 7, 9, 10], optional: [7, 2], rank: 4 },
  { symbol: 'maj13', name: 'major 13th', intervals: [0, 2, 4, 7, 9, 11], optional: [7, 2], rank: 5 },
  { symbol: 'm13', name: 'minor 13th', intervals: [0, 2, 3, 7, 9, 10], optional: [7, 2], rank: 6 },
];

export type ChordResult = {
  /** Full display symbol including any slash bass, e.g. "C/E", "Dm7". */
  symbol: string;
  /** Symbol without the slash bass, e.g. "C". */
  rootSymbol: string;
  root: number;
  rootName: string;
  quality: string;
  /** Chord-symbol suffix only, e.g. "m7" — empty string for a plain major. */
  qualitySymbol: string;
  /** Interval set of the matched template, in semitones from the root. */
  intervals: number[];
  bass: number;
  bassName: string;
  /** 0 = root position, 1 = first inversion, ... */
  inversion: number;
  inversionName: string;
  /** Pitch classes actually sounding. */
  pitchClasses: number[];
  /** Intervals present that the template does not account for. */
  extras: number[];
  /** Template intervals not sounding. */
  missing: number[];
  /** true when the sounding notes match the template exactly. */
  exact: boolean;
  notes: number[];
};

const INVERSION_NAMES = ['root position', '1st inversion', '2nd inversion', '3rd inversion', '4th inversion', '5th inversion'];

/**
 * Identify the chord formed by a set of sounding MIDI notes.
 *
 * Returns `null` for fewer than two notes. Two notes are reported as an
 * interval (or as a power chord when they are a fifth apart).
 */
export function detectChord(input: Iterable<number>, accidental: Accidental = 'sharp'): ChordResult | null {
  const notes = [...new Set(input)].sort((a, b) => a - b);
  if (notes.length < 2) return null;

  const bass = notes[0];
  const bassPc = pitchClass(bass);
  const pcs = [...new Set(notes.map(pitchClass))].sort((a, b) => a - b);

  // A single pitch class doubled across octaves is not a chord.
  if (pcs.length < 2) return null;

  let best: { template: ChordTemplate; root: number; score: number; extras: number[]; missing: number[] } | null = null;

  for (let root = 0; root < 12; root++) {
    const intervals = new Set(pcs.map(pc => (pc - root + 12) % 12));
    // The root must be sounding somewhere, or the reading is speculative.
    if (!intervals.has(0)) continue;

    for (const template of CHORD_TEMPLATES) {
      const templateSet = new Set(template.intervals);
      const optional = new Set(template.optional ?? []);

      const extras = [...intervals].filter(i => !templateSet.has(i)).sort((a, b) => a - b);
      const missing = [...templateSet].filter(i => !intervals.has(i)).sort((a, b) => a - b);
      // Omitting a non-optional chord tone is a much weaker match.
      const missingCost = missing.reduce((sum, i) => sum + (optional.has(i) ? 0.35 : 2.6), 0);

      const score =
        extras.length * 3 +
        missingCost +
        template.rank * 0.08 +
        (root === bassPc ? 0 : 0.45) +
        // Prefer the simplest template that explains the notes.
        template.intervals.length * 0.02;

      if (!best || score < best.score) best = { template, root, score, extras, missing };
    }
  }

  if (!best || best.score > 6) {
    return twoNoteFallback(notes, accidental);
  }
  // Two notes rarely justify a four-note reading; prefer the interval name.
  if (pcs.length === 2 && best.template.intervals.length > 2) {
    return twoNoteFallback(notes, accidental);
  }

  const { template, root, extras, missing } = best;
  const rootName = noteName(root, accidental);
  const rootSymbol = `${rootName}${template.symbol}`;
  const bassName = noteName(bass, accidental);
  const slash = pitchClass(root) !== bassPc;

  // Inversion = index of the bass within the chord's stacked intervals.
  const bassInterval = (bassPc - root + 12) % 12;
  const stacked = [...template.intervals].sort((a, b) => a - b);
  const inversionIndex = stacked.indexOf(bassInterval);
  const inversion = inversionIndex >= 0 ? inversionIndex : 0;

  return {
    symbol: slash ? `${rootSymbol}/${bassName}` : rootSymbol,
    rootSymbol,
    root,
    rootName,
    quality: template.name,
    qualitySymbol: template.symbol,
    intervals: [...template.intervals].sort((a, b) => a - b),
    bass,
    bassName,
    inversion,
    inversionName: INVERSION_NAMES[inversion] ?? `${inversion}th inversion`,
    pitchClasses: pcs,
    extras,
    missing,
    exact: extras.length === 0 && missing.length === 0,
    notes,
  };
}

function twoNoteFallback(notes: number[], accidental: Accidental): ChordResult | null {
  if (notes.length < 2) return null;
  const [low, high] = [notes[0], notes[notes.length - 1]];
  const semitones = high - low;
  const rootName = noteName(low, accidental);
  return {
    symbol: `${rootName} ${intervalName(semitones)}`,
    rootSymbol: rootName,
    root: pitchClass(low),
    rootName,
    quality: intervalName(semitones).toLowerCase(),
    qualitySymbol: '',
    intervals: [0, (((high - low) % 12) + 12) % 12],
    bass: low,
    bassName: rootName,
    inversion: 0,
    inversionName: 'interval',
    pitchClasses: [...new Set(notes.map(pitchClass))].sort((a, b) => a - b),
    extras: [],
    missing: [],
    exact: true,
    notes,
  };
}

/* ------------------------------------------------------------------ *
 * Key context and Roman numeral analysis
 * ------------------------------------------------------------------ */

export type Mode = 'major' | 'minor';

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/**
 * Every semitone above the key root, as a scale degree plus an accidental.
 * The tritone is written as a sharp fourth rather than a flat fifth, which is
 * the commoner reading in practice.
 */
const CHROMATIC_DEGREES: Array<[number, string]> = [
  [0, ''],    // I
  [1, '♭'],  // flat II
  [1, ''],    // II
  [2, '♭'],  // flat III
  [2, ''],    // III
  [3, ''],    // IV
  [3, '♯'],  // sharp IV
  [4, ''],    // V
  [5, '♭'],  // flat VI
  [5, ''],    // VI
  [6, '♭'],  // flat VII
  [6, ''],    // VII
];

export function scaleNotes(keyRoot: number, mode: Mode): number[] {
  const steps = mode === 'major' ? MAJOR_STEPS : MINOR_STEPS;
  return steps.map(step => (keyRoot + step) % 12);
}

/**
 * Roman numeral for a detected chord within a key. Uppercase for major-quality
 * chords, lowercase for minor, with the usual ° and + for diminished and
 * augmented, plus a figured-bass inversion suffix.
 */
export function romanNumeral(chord: ChordResult, keyRoot: number, mode: Mode): string | null {
  // Every chromatic step has a number, so a chord from outside the key is
  // named rather than ignored: the flat second, the sharp fourth, the flat
  // seventh. The major scale is the reference for both modes, which is how the
  // number system is normally written — a minor key reads i, ♭III, ♭VI, ♭VII.
  const semitones = (pitchClass(chord.root) - pitchClass(keyRoot) + 12) % 12;
  const [index, accidental] = CHROMATIC_DEGREES[semitones];

  // Classify by interval content, not by name: a minor third makes the numeral
  // lowercase, whatever the template happens to be called.
  const has = (i: number) => chord.intervals.includes(i);
  const isMinorThird = has(3) && !has(4);
  const isDiminished = has(3) && has(6) && !has(7);
  const isHalfDim = isDiminished && has(10);
  const isAugmented = has(4) && has(8) && !has(7);

  let numeral = accidental + (isMinorThird ? ROMAN[index].toLowerCase() : ROMAN[index]);

  if (isHalfDim) numeral += 'ø';
  else if (isDiminished) numeral += '°';
  else if (isAugmented) numeral += '+';

  const seventh = has(10) || has(11) || (isDiminished && has(9));
  if (chord.inversion === 1) numeral += seventh ? '65' : '6';
  else if (chord.inversion === 2) numeral += seventh ? '43' : '64';
  else if (chord.inversion === 3) numeral += '42';
  else if (seventh) numeral += '7';

  return numeral;
}

export const KEY_NAMES = NOTE_NAMES_SHARP;
