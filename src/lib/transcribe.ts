/**
 * Turning a recording into notes for the piano roll.
 *
 * The listening itself is done by Basic Pitch, a small neural network from
 * Spotify published under the Apache licence. It runs entirely on this
 * computer: nothing is uploaded, which matters for a teacher working with
 * somebody else's recording. It is good at a solo instrument and gets messier
 * as a mix gets denser, because it was trained to hear notes, not to pull one
 * instrument out of a band. Separating the stems first is what fixes that.
 *
 * The network and its runtime are loaded only when a song is first analysed.
 * They are several megabytes, and the rest of the app should not wait for them
 * at start-up or carry them into a lesson that never opens this tab.
 *
 * Everything below the loader is plain arithmetic on the notes it returns, and
 * is tested on its own.
 */

export type RollNote = {
  /** Seconds from the start of the recording. */
  start: number;
  end: number;
  midi: number;
  /** 0..1, how strongly it was played. */
  velocity: number;
  /** True for the top line, which is drawn differently so it can be followed. */
  melody: boolean;
};

/** The sample rate the network was trained on. */
export const MODEL_RATE = 22050;

/** The range of a piano, which is also all the roll can show. */
const LOWEST = 21;
const HIGHEST = 108;

/**
 * Tidy what the network returns.
 *
 * It errs on the side of reporting too much: very short blips where a drum hit
 * had some pitch to it, and faint ghosts an octave above real notes. Both make
 * a piano roll unreadable, and neither would be played by a person learning
 * the part, so they are dropped.
 */
export function tidyNotes(
  raw: Array<{ start: number; end: number; midi: number; velocity: number }>,
  options: { minSeconds?: number; minVelocity?: number } = {},
): RollNote[] {
  const minSeconds = options.minSeconds ?? 0.07;
  const minVelocity = options.minVelocity ?? 0.16;
  const rounded = raw.map(note => ({ ...note, midi: Math.round(note.midi), melody: false }));
  return joinFragments(rounded)
    .filter(note =>
      note.end - note.start >= minSeconds
      && note.velocity >= minVelocity
      && note.midi >= LOWEST && note.midi <= HIGHEST)
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/**
 * Join a note that the network split at its attack.
 *
 * The first few hundredths of a plucked or struck note are mostly noise, and
 * the network often reports them as a short note of their own, then the real
 * one straight after on the same key. A short note running directly into a
 * longer one at the same pitch is one note. A long note followed by another is
 * left alone: that is the same key played twice.
 */
export function joinFragments(notes: RollNote[], maxGap = 0.035, maxStub = 0.13): RollNote[] {
  const sorted = [...notes].sort((a, b) => a.midi - b.midi || a.start - b.start);
  const out: RollNote[] = [];
  sorted.forEach(note => {
    const before = out[out.length - 1];
    if (
      before && before.midi === note.midi
      && note.start - before.end <= maxGap
      && before.end - before.start <= maxStub
    ) {
      before.end = Math.max(before.end, note.end);
      before.velocity = Math.max(before.velocity, note.velocity);
    } else {
      out.push({ ...note });
    }
  });
  return out;
}

/**
 * Mark the melody: at each moment, the highest note that is sounding.
 *
 * This is the skyline rule, and it is right far more often than it has any
 * business being, because that is how music is written — the tune goes on top
 * so it can be heard. A note counts if it is the highest thing sounding when it
 * starts, and is not so low that it can only be accompaniment.
 */
export function markMelody(notes: RollNote[], lowest = 55): RollNote[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  return sorted.map(note => {
    if (note.midi < lowest) return { ...note, melody: false };
    const at = note.start + 0.01;
    const topped = sorted.some(other =>
      other !== note && other.midi > note.midi && other.start <= at && other.end > at);
    return { ...note, melody: !topped };
  });
}

/** The notes sounding at a moment, for lighting the keyboard. */
export function notesAt(notes: RollNote[], time: number): RollNote[] {
  // Notes are sorted by start, so anything starting after `time` ends the scan.
  const out: RollNote[] = [];
  for (let i = 0; i < notes.length; i += 1) {
    if (notes[i].start > time) break;
    if (notes[i].end > time) out.push(notes[i]);
  }
  return out;
}

/** The notes that overlap a stretch of time, for drawing one screen of the roll. */
export function notesBetween(notes: RollNote[], from: number, to: number): RollNote[] {
  const out: RollNote[] = [];
  for (let i = 0; i < notes.length; i += 1) {
    if (notes[i].start > to) break;
    if (notes[i].end >= from) out.push(notes[i]);
  }
  return out;
}

/** The pitch range actually used, padded, so the roll is not mostly empty. */
export function usedRange(notes: RollNote[]): { low: number; high: number } {
  if (!notes.length) return { low: 48, high: 84 };
  let low = HIGHEST;
  let high = LOWEST;
  notes.forEach(note => {
    low = Math.min(low, note.midi);
    high = Math.max(high, note.midi);
  });
  // At least two octaves, so a narrow tune is not stretched into fat bars.
  while (high - low < 24) {
    if (low > LOWEST) low -= 1;
    if (high < HIGHEST) high += 1;
    if (low === LOWEST && high === HIGHEST) break;
  }
  return { low: Math.max(LOWEST, low - 2), high: Math.min(HIGHEST, high + 2) };
}

/* ------------------------------------------------------------------ *
 * The network
 * ------------------------------------------------------------------ */

/** Mix to mono and resample to what the network expects. */
export async function prepareAudio(buffer: AudioBuffer): Promise<Float32Array> {
  const length = Math.ceil(buffer.duration * MODEL_RATE);
  const offline = new OfflineAudioContext(1, Math.max(1, length), MODEL_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Read a bundled file as bytes.
 *
 * The packaged app is served from disk, where fetch is not always allowed, so
 * an old-fashioned request stands by as the fallback.
 */
async function loadBytes(url: string): Promise<ArrayBuffer> {
  try {
    const response = await fetch(url);
    if (response.ok) return await response.arrayBuffer();
  } catch { /* fall through to the request below */ }
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url);
    request.responseType = 'arraybuffer';
    request.onload = () => (request.response ? resolve(request.response as ArrayBuffer) : reject(new Error('empty')));
    request.onerror = () => reject(new Error(`Could not read ${url}`));
    request.send();
  });
}

type Runtime = {
  pitch: import('@spotify/basic-pitch').BasicPitch;
  tools: typeof import('@spotify/basic-pitch');
};

let runtime: Promise<Runtime> | null = null;

/** Load the network once, the first time it is needed. */
function loadRuntime(): Promise<Runtime> {
  if (runtime) return runtime;
  runtime = (async () => {
    const [tools, tf] = await Promise.all([
      import('@spotify/basic-pitch'),
      import('@tensorflow/tfjs'),
    ]);
    const base = new URL('./basic-pitch/', document.baseURI).href;
    const topology = JSON.parse(new TextDecoder().decode(await loadBytes(`${base}model.json`)));
    const weights = await loadBytes(`${base}${topology.weightsManifest[0].paths[0]}`);
    const model = tf.loadGraphModel(tf.io.fromMemory({
      modelTopology: topology.modelTopology,
      weightSpecs: topology.weightsManifest[0].weights,
      weightData: weights,
      format: topology.format,
      generatedBy: topology.generatedBy,
      convertedBy: topology.convertedBy,
    }));
    return { pitch: new tools.BasicPitch(model), tools };
  })();
  // A failed load should be retried next time, not remembered forever.
  runtime.catch(() => { runtime = null; });
  return runtime;
}

/**
 * Transcribe a recording into notes.
 *
 * Progress runs from 0 to 1. The network works through the audio in chunks and
 * yields between them, so the interface stays alive while it runs.
 */
export async function transcribe(
  buffer: AudioBuffer, onProgress?: (fraction: number) => void,
): Promise<RollNote[]> {
  onProgress?.(0);
  const [{ pitch, tools }, audio] = await Promise.all([loadRuntime(), prepareAudio(buffer)]);

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await pitch.evaluateModel(
    audio,
    (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
    fraction => onProgress?.(Math.min(0.98, fraction)),
  );

  const events = tools.noteFramesToTime(
    tools.addPitchBendsToNoteEvents(contours, tools.outputToNotesPoly(frames, onsets, 0.5, 0.3, 5)),
  );
  onProgress?.(1);
  return markMelody(tidyNotes(events.map(event => ({
    start: event.startTimeSeconds,
    end: event.startTimeSeconds + event.durationSeconds,
    midi: event.pitchMidi,
    velocity: event.amplitude,
  }))));
}
