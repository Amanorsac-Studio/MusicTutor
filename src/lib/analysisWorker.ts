/**
 * Chord analysis, off the main thread.
 *
 * Naming the chords of a long song is several seconds of arithmetic, twice over
 * once the stems are in. On the main thread that is several seconds of a frozen
 * window — and of a frozen recording, if one is running. So it happens here.
 */

import { recogniseChords, type ChordSegment } from './chordTrack';

export type ChordRequest = {
  id: number;
  samples: Float32Array;
  bassSamples?: Float32Array;
  sampleRate: number;
  beats: number[];
  concertPitch: number;
};

export type ChordResponse =
  | { id: number; kind: 'done'; segments: ChordSegment[] }
  | { id: number; kind: 'error'; message: string };

self.onmessage = (event: MessageEvent<ChordRequest>) => {
  const { id, samples, bassSamples, sampleRate, beats, concertPitch } = event.data;
  let message: ChordResponse;
  try {
    message = {
      id, kind: 'done',
      segments: recogniseChords(samples, sampleRate, beats, { concertPitch, bassSamples }),
    };
  } catch (error) {
    message = { id, kind: 'error', message: error instanceof Error ? error.message : 'The chords could not be heard.' };
  }
  self.postMessage(message);
};
