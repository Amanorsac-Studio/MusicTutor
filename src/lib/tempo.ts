/**
 * Tempo detection.
 *
 * Three stages, each fixing a weakness of the one the old version had.
 *
 * Where the notes are: a spectral-flux onset envelope, from ./onsets. The old
 * detector measured loudness, which barely moves when a melody is played over
 * an accompaniment, so anything without drums was a guess.
 *
 * Which periods repeat: autocorrelation, as before, but its peaks are treated
 * as suggestions rather than an answer. Autocorrelation cannot tell a tempo
 * from half or double it, so the halves and doubles are gathered too.
 *
 * Which of them is the tempo: the beat tracker lays down its best run of beats
 * at each candidate, and the one whose beats land on the most actual notes
 * wins. A tall correlation peak only means something repeats; beats landing on
 * notes means it is the pulse.
 *
 * It reports a confidence figure, so the interface can say when the music is
 * genuinely ambiguous rather than pretending otherwise.
 */

import { ONSET_HOP, frameTime, onsetEnvelope, removeDrift } from './onsets';
import { trackBeatFrames } from './beats';

export type TempoEstimate = {
  bpm: number;
  /** 0..1. Below about 0.3 the result should be treated as a guess. */
  confidence: number;
  /** Seconds from the start of the track to the first detected beat. */
  offset: number;
  /** Other plausible readings, usually half and double time. */
  alternatives: number[];
};

export const MIN_BPM = 60;

/** Most music sits near here, so ambiguous readings are pulled toward it. */
export const PREFERRED_BPM = 120;
/** Width of that preference, in tempo octaves. */
export const TEMPO_SPREAD = 0.85;
export const MAX_BPM = 200;

/** Analysis hop, in samples. Set by the onset detector, which does the work. */
export const ANALYSIS_HOP = ONSET_HOP;

export { onsetEnvelope } from './onsets';

/** Autocorrelation of the envelope across the plausible beat-period range. */
export function tempoScores(
  envelope: Float32Array,
  sampleRate: number,
  hopSize: number,
): Array<{ bpm: number; score: number; lag: number }> {
  const framesPerSecond = sampleRate / hopSize;
  const minLag = Math.max(1, Math.floor((60 / MAX_BPM) * framesPerSecond));
  const maxLag = Math.min(envelope.length - 1, Math.ceil((60 / MIN_BPM) * framesPerSecond));

  const scores: Array<{ bpm: number; score: number; lag: number }> = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i + lag < envelope.length; i++) {
      sum += envelope[i] * envelope[i + lag];
      count++;
    }
    if (!count) continue;
    scores.push({ bpm: (60 * framesPerSecond) / lag, score: sum / count, lag });
  }
  return scores;
}

/** Where the beat grid starts, given a period in frames. */
function findOffset(envelope: Float32Array, lag: number, hopSize: number, sampleRate: number): number {
  let bestPhase = 0;
  let bestScore = -1;
  for (let phase = 0; phase < lag; phase++) {
    let sum = 0;
    for (let i = phase; i < envelope.length; i += lag) sum += envelope[i];
    if (sum > bestScore) { bestScore = sum; bestPhase = phase; }
  }
  return (bestPhase * hopSize) / sampleRate;
}

/**
 * Estimate the tempo of decoded audio.
 *
 * Analyses at most the first 60 seconds; that is plenty for a steady tempo and
 * keeps a long track from stalling the interface.
 */
/**
 * Candidate tempi worth testing, strongest first.
 *
 * Autocorrelation is good at saying which periods repeat and hopeless at
 * choosing between a tempo and half or double it, since a 120 bpm pulse
 * correlates perfectly at 60. So this gathers the peaks and deliberately adds
 * their halves and doubles rather than picking a winner, and the choice is made
 * afterwards by seeing which one the music actually fits.
 */
export function tempoCandidates(
  envelope: Float32Array, sampleRate: number, hopSize: number, limit = 5,
): number[] {
  const scores = tempoScores(envelope, sampleRate, hopSize);
  if (!scores.length) return [];

  // Local maxima only: neighbouring lags say the same thing.
  const peaks = scores.filter((item, index) => {
    const before = scores[index - 1]?.score ?? -Infinity;
    const after = scores[index + 1]?.score ?? -Infinity;
    return item.score >= before && item.score >= after;
  });
  peaks.sort((a, b) => b.score - a.score);

  const candidates: number[] = [];
  const add = (bpm: number) => {
    if (bpm < MIN_BPM * 0.5 || bpm > MAX_BPM * 1.5) return;
    // Anything within a percent of one already present is the same tempo.
    if (candidates.some(existing => Math.abs(existing - bpm) / bpm < 0.01)) return;
    candidates.push(bpm);
  };

  peaks.slice(0, limit).forEach(peak => {
    const refined = refineLag(scores, peak.lag);
    const bpm = (60 * (sampleRate / hopSize)) / refined;
    add(bpm);
    add(bpm / 2);
    add(bpm * 2);
    // Triple and a third catch music counted in three against a four feel.
    add(bpm * 3);
    add(bpm / 3);
  });
  return candidates;
}

/**
 * Recover the fractional lag under a peak.
 *
 * Lags are whole frames, which quantises the tempo to a few percent — 120 bpm
 * lands between two lags and reads as 117.5 or 123. A parabola through the peak
 * and its neighbours brings the error under a percent.
 */
function refineLag(scores: Array<{ bpm: number; score: number; lag: number }>, lag: number): number {
  const index = scores.findIndex(item => item.lag === lag);
  const before = scores[index - 1]?.score;
  const peak = scores[index]?.score;
  const after = scores[index + 1]?.score;
  if (before === undefined || after === undefined || peak === undefined) return lag;
  const denominator = before - 2 * peak + after;
  if (denominator === 0) return lag;
  const shift = (0.5 * (before - after)) / denominator;
  return Math.abs(shift) <= 0.5 ? lag + shift : lag;
}

/**
 * How well a tempo actually explains the music.
 *
 * This is what the old detector was missing. It took the tallest correlation
 * peak and trusted it; a tall peak only means something repeats at that
 * interval, which a shuffle or a strong off-beat can produce just as easily.
 *
 * Here each candidate is handed to the beat tracker, which lays down the best
 * possible run of beats at that tempo, and the score is how much onset strength
 * those beats actually landed on, per beat. A tempo that is genuinely the pulse
 * puts its beats on the notes; a spurious one cannot, however well it
 * correlated.
 */
export function scoreTempo(
  envelope: Float32Array, bpm: number, framesPerSecond: number,
): { score: number; beats: number[] } {
  const period = (60 / bpm) * framesPerSecond;
  if (period < 2 || period > envelope.length) return { score: 0, beats: [] };
  const beats = trackBeatFrames(envelope, period);
  if (beats.length < 2) return { score: 0, beats: [] };

  // How strongly the beats themselves land. A tempo whose beats fall in the
  // gaps scores badly here.
  let landed = 0;
  beats.forEach(frame => { landed += envelope[frame] ?? 0; });
  const precision = landed / beats.length;

  /*
   * And how much of the music those beats account for.
   *
   * This is the half that decides between a tempo and half of it. Both put
   * every beat on a real note, so both look perfect by the measure above — but
   * the slower one ignores every second note, and this notices. A window of a
   * fifth of a beat either side is wide enough to allow for a player pushing or
   * dragging and narrow enough that a missed note stays missed.
   */
  const tolerance = Math.max(1, Math.round(period * 0.2));
  const covered = new Uint8Array(envelope.length);
  beats.forEach(frame => {
    const from = Math.max(0, frame - tolerance);
    const to = Math.min(envelope.length - 1, frame + tolerance);
    for (let i = from; i <= to; i += 1) covered[i] = 1;
  });

  let explained = 0;
  let total = 0;
  for (let i = 0; i < envelope.length; i += 1) {
    total += envelope[i];
    if (covered[i]) explained += envelope[i];
  }
  if (total <= 0) return { score: 0, beats };
  const recall = explained / total;

  // Both matter, so they multiply: beats on notes, and notes on beats.
  return { score: precision * recall, beats };
}

/**
 * Estimate the tempo of decoded audio.
 *
 * Analyses at most the first 60 seconds; that is plenty for a steady tempo and
 * keeps a long track from stalling the interface.
 */
/**
 * Estimate the tempo of decoded audio.
 *
 * Analyses at most the first 60 seconds; that is plenty for a steady tempo and
 * keeps a long track from stalling the interface.
 *
 * The method, in order: find where notes begin, gather every period that
 * repeats along with its halves and doubles, then have the beat tracker try
 * each one and keep whichever puts its beats on the most actual notes. The
 * listener's bias toward moderate tempi settles anything still close.
 */
export function detectTempo(
  samples: Float32Array,
  sampleRate: number,
  options: { hopSize?: number; maxSeconds?: number } = {},
): TempoEstimate {
  const hopSize = options.hopSize ?? ANALYSIS_HOP;
  const maxSeconds = options.maxSeconds ?? 60;
  const limit = Math.min(samples.length, Math.floor(sampleRate * maxSeconds));
  const slice = limit < samples.length ? samples.subarray(0, limit) : samples;

  const raw = onsetEnvelope(slice, sampleRate, hopSize);
  if (raw.length < 8) return { bpm: 120, confidence: 0, offset: 0, alternatives: [] };
  const envelope = removeDrift(raw);

  const framesPerSecond = sampleRate / hopSize;
  const candidates = tempoCandidates(envelope, sampleRate, hopSize);
  if (!candidates.length) return { bpm: 120, confidence: 0, offset: 0, alternatives: [] };

  /*
   * Judge the candidates on a slice rather than the whole track.
   *
   * Each one is beat-tracked in full, which is the expensive part, and twenty
   * seconds is more than enough to tell a tempo from half of it. The winner is
   * then tracked across everything that was analysed.
   */
  const judgingFrames = Math.min(envelope.length, Math.round(framesPerSecond * 20));
  const sample = envelope.subarray(0, judgingFrames);

  const judged = candidates.map(bpm => {
    const fit = scoreTempo(sample, bpm, framesPerSecond);
    // A listener hearing an ambiguous pulse counts it at a comfortable speed
    // rather than at a crawl or a sprint, so a moderate tempo needs slightly
    // less evidence than an extreme one to win.
    const octaves = Math.log2(bpm / PREFERRED_BPM);
    const preference = Math.exp(-0.5 * (octaves / TEMPO_SPREAD) ** 2);
    return { bpm, fit: fit.score, beats: fit.beats, total: fit.score * preference };
  }).sort((a, b) => b.total - a.total);

  const best = judged[0];
  const runnerUp = judged[1];
  // The winner, now measured over everything that was analysed.
  const full = scoreTempo(envelope, best.bpm, framesPerSecond);
  best.beats = full.beats.length ? full.beats : best.beats;

  // How clearly the winner won. Two readings that fit equally well mean the
  // music is genuinely ambiguous, and saying so is more use than a number
  // presented with false certainty.
  const margin = runnerUp && best.total > 0
    ? (best.total - runnerUp.total) / best.total
    : 1;
  const strength = Math.min(1, best.fit * 3);
  const confidence = Math.max(0, Math.min(1, strength * (0.45 + 0.55 * margin)));

  /*
   * Read the tempo back off the beats rather than reporting the candidate.
   *
   * Candidates come from correlation peaks, which are quantised, and the
   * tracker will happily bend a few percent to put its beats on the notes. So
   * the beats it actually laid down are a better measurement than the number it
   * was asked to try. The median gap is used, so one dropped beat cannot drag
   * the answer with it.
   */
  const gaps: number[] = [];
  for (let i = 1; i < best.beats.length; i += 1) gaps.push(best.beats[i] - best.beats[i - 1]);
  gaps.sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  const measured = median > 0 ? (60 * framesPerSecond) / median : best.bpm;
  // Only trust it when it agrees with the candidate; a wild disagreement means
  // the tracker lost the beat rather than refined it.
  const bpm = Math.abs(measured - best.bpm) / best.bpm < 0.15 ? measured : best.bpm;

  // The first beat the tracker found, which is where the grid starts.
  const offset = best.beats.length ? frameTime(best.beats[0], sampleRate, hopSize) : 0;

  // The readings that nearly won, offered as one-click corrections. Half and
  // double are the usual disagreements, so they are always included.
  const alternatives = [
    ...judged.slice(1, 3).map(item => item.bpm),
    bpm / 2,
    bpm * 2,
  ]
    .filter(other => other >= 40 && other <= 250)
    .map(other => Math.round(other * 10) / 10)
    .filter((other, index, all) =>
      all.indexOf(other) === index && Math.abs(other - bpm) / bpm > 0.02)
    .slice(0, 3);

  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    offset,
    alternatives,
  };
}

/** Seconds per beat. */
export const beatLength = (bpm: number): number => 60 / Math.max(1, bpm);

/** Snap a time to the nearest beat of a grid, for tidy loop points. */
export function snapToBeat(time: number, bpm: number, offset = 0): number {
  const beat = beatLength(bpm);
  if (beat <= 0) return time;
  return Math.max(0, offset + Math.round((time - offset) / beat) * beat);
}

/** Bars and beats at a given time, counting from one, in 4/4. */
export function beatPosition(time: number, bpm: number, offset = 0, beatsPerBar = 4): { bar: number; beat: number } {
  const beats = Math.max(0, (time - offset) / beatLength(bpm));
  return {
    bar: Math.floor(beats / beatsPerBar) + 1,
    beat: Math.floor(beats % beatsPerBar) + 1,
  };
}
