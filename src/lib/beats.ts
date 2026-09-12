/**
 * Where the beats actually fall.
 *
 * Knowing the tempo is not the same as knowing the beat. A tempo says how far
 * apart the beats are; it does not say where the first one lands, and a tempo
 * alone drifts out of step over a few minutes because no performance is exactly
 * steady. For a practice tool the positions are what matter: they are what a
 * loop should snap to, what the metronome should line up with, and what the
 * marks on the waveform mean.
 *
 * This is beat tracking by dynamic programming, after Ellis. The idea is that
 * the best set of beats is the one that scores highest on two things at once:
 * each beat sitting on a moment where the music pushes, and the gaps between
 * beats staying close to the tempo. Rather than deciding beat by beat and
 * hoping, it scores every possible beat position against the best sequence that
 * could lead to it, then walks the winner back from the end. That way a passage
 * with a weak downbeat is carried by the ones either side of it.
 */

import { onsetEnvelope, ANALYSIS_HOP } from './tempo';

/**
 * How strongly the tracker resists drifting off the tempo.
 *
 * Higher keeps the beats evenly spaced and ignores a syncopated accent; lower
 * follows the music and risks wandering. This value is the one Ellis settled on
 * and it holds up on the material a piano teacher is likely to load.
 */
export const TIGHTNESS = 100;

/**
 * Penalty for a gap that is not the expected one.
 *
 * Squared log of the ratio, so being out by a factor of two costs the same
 * whether the gap is twice too long or half too short — which is the right
 * shape, since those are the same musical mistake.
 */
export const transitionCost = (gap: number, expected: number, tightness = TIGHTNESS): number => {
  if (gap <= 0 || expected <= 0) return -Infinity;
  const ratio = Math.log(gap / expected);
  return -tightness * ratio * ratio;
};

/** Smooth the envelope a little and take out its slow drift. */
export function conditionEnvelope(envelope: Float32Array): Float32Array {
  const out = new Float32Array(envelope.length);
  // A short moving average of the local level, subtracted, so a loud chorus
  // does not outweigh a quiet verse and swallow its beats.
  const window = 32;
  let sum = 0;
  for (let i = 0; i < envelope.length; i += 1) {
    sum += envelope[i];
    if (i >= window) sum -= envelope[i - window];
    const local = sum / Math.min(i + 1, window);
    out[i] = Math.max(0, envelope[i] - local);
  }

  let peak = 0;
  for (let i = 0; i < out.length; i += 1) peak = Math.max(peak, out[i]);
  if (peak > 0) for (let i = 0; i < out.length; i += 1) out[i] /= peak;
  return out;
}

/**
 * The beat positions, as indexes into the onset envelope.
 *
 * `period` is the expected gap between beats in envelope frames.
 */
export function trackBeatFrames(
  envelope: Float32Array, period: number, tightness = TIGHTNESS,
): number[] {
  const length = envelope.length;
  if (length === 0 || period < 1) return [];

  const score = new Float32Array(length);
  const previous = new Int32Array(length).fill(-1);

  // Beats are looked for between half and double the expected gap back, which
  // is wide enough to ride out a slowing without letting the tracker skip one.
  const from = Math.max(1, Math.round(period * 0.5));
  const to = Math.max(from + 1, Math.round(period * 2));

  for (let i = 0; i < length; i += 1) {
    let bestScore = -Infinity;
    let bestFrom = -1;
    for (let gap = from; gap <= to; gap += 1) {
      const j = i - gap;
      if (j < 0) break;
      const candidate = score[j] + transitionCost(gap, period, tightness);
      if (candidate > bestScore) {
        bestScore = candidate;
        bestFrom = j;
      }
    }
    // A beat at the very start has nothing behind it, so it stands on its own.
    if (bestFrom < 0) {
      score[i] = envelope[i];
      previous[i] = -1;
    } else {
      score[i] = envelope[i] + bestScore;
      previous[i] = bestFrom;
    }
  }

  // The chain is read back from wherever it scored highest, ignoring the last
  // stretch of the track, where a chain has had less chance to accumulate.
  let end = -1;
  let bestFinal = -Infinity;
  const tail = Math.max(0, length - Math.round(period));
  for (let i = tail; i < length; i += 1) {
    if (score[i] > bestFinal) {
      bestFinal = score[i];
      end = i;
    }
  }
  if (end < 0) return [];

  const beats: number[] = [];
  for (let at = end; at >= 0; at = previous[at]) {
    beats.push(at);
    if (previous[at] < 0) break;
  }
  return beats.reverse();
}

export type BeatGrid = {
  /** Beat positions in seconds from the start of the track. */
  beats: number[];
  /** Beats per bar assumed when marking downbeats. */
  beatsPerBar: number;
  /** Index into `beats` of the first downbeat. */
  firstDownbeat: number;
};

/**
 * Find the beats in a decoded track.
 *
 * The tempo is given rather than detected here, so a teacher who corrects a
 * misread tempo gets beats that follow the correction.
 */
export function trackBeats(
  samples: Float32Array,
  sampleRate: number,
  bpm: number,
  beatsPerBar = 4,
  hopSize = ANALYSIS_HOP,
): BeatGrid {
  const envelope = conditionEnvelope(onsetEnvelope(samples, sampleRate, hopSize));
  const hopSeconds = hopSize / sampleRate;
  const period = 60 / Math.max(1, bpm) / hopSeconds;
  const frames = trackBeatFrames(envelope, period);
  const beats = frames.map(frame => frame * hopSeconds);
  return {
    beats,
    beatsPerBar,
    firstDownbeat: strongestDownbeat(frames, envelope, beatsPerBar),
  };
}

/**
 * Which beat of the bar the music starts on.
 *
 * Bar one is wherever the accents are strongest: summing the onset strength of
 * every candidate first beat and taking the winner finds the downbeat without
 * needing to understand the music.
 */
export function strongestDownbeat(
  frames: number[], envelope: Float32Array, beatsPerBar: number,
): number {
  if (frames.length < beatsPerBar || beatsPerBar < 2) return 0;
  let best = 0;
  let bestTotal = -Infinity;
  for (let phase = 0; phase < beatsPerBar; phase += 1) {
    let total = 0;
    for (let i = phase; i < frames.length; i += beatsPerBar) {
      total += envelope[frames[i]] ?? 0;
    }
    if (total > bestTotal) {
      bestTotal = total;
      best = phase;
    }
  }
  return best;
}

/** The nearest beat to a moment, or the moment itself when there is no grid. */
export function nearestBeat(time: number, beats: number[]): number {
  if (!beats.length) return time;
  let best = beats[0];
  let bestGap = Math.abs(time - best);
  for (let i = 1; i < beats.length; i += 1) {
    const gap = Math.abs(time - beats[i]);
    if (gap < bestGap) {
      bestGap = gap;
      best = beats[i];
    }
    // The list is in order, so once the gap grows the answer is behind us.
    if (beats[i] > time && gap > bestGap) break;
  }
  return best;
}

/** The nearest downbeat, for looping a whole bar rather than part of one. */
export function nearestBar(time: number, grid: BeatGrid): number {
  const downbeats = grid.beats.filter(
    (_, index) => (index - grid.firstDownbeat) % grid.beatsPerBar === 0,
  );
  return downbeats.length ? nearestBeat(time, downbeats) : time;
}

/**
 * Tempo implied by the tracked beats, which is the honest figure to show.
 *
 * The detector's answer is a guess about the whole track; this is the average
 * of what was actually found, and the two disagreeing is a sign the reading
 * should not be trusted.
 */
export function tempoFromBeats(beats: number[]): number {
  if (beats.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < beats.length; i += 1) gaps.push(beats[i] - beats[i - 1]);
  gaps.sort((a, b) => a - b);
  // The median, so one dropped beat does not drag the answer with it.
  const middle = gaps[Math.floor(gaps.length / 2)];
  return middle > 0 ? 60 / middle : 0;
}
