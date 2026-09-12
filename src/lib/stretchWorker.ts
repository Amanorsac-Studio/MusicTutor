/**
 * Time stretching, off the main thread.
 *
 * Stretching a four-minute track is seconds of arithmetic. Doing it on the main
 * thread would freeze the whole app — including the scene compositor, which is
 * painting the recording — so it happens here and reports progress on the way.
 */

import { stretchChannels } from './timeStretch';

export type StretchRequest = {
  id: number;
  channels: Float32Array[];
  factor: number;
};

export type StretchResponse =
  | { id: number; kind: 'progress'; fraction: number }
  | { id: number; kind: 'done'; channels: Float32Array[] }
  | { id: number; kind: 'error'; message: string };

self.onmessage = (event: MessageEvent<StretchRequest>) => {
  const { id, channels, factor } = event.data;
  try {
    const out = stretchChannels(channels, factor, {
      onProgress: fraction => {
        const message: StretchResponse = { id, kind: 'progress', fraction };
        self.postMessage(message);
      },
    });
    const message: StretchResponse = { id, kind: 'done', channels: out };
    // The buffers are handed over rather than copied; nothing here needs them
    // afterwards and a copy of a four-minute track is tens of megabytes.
    (self as unknown as Worker).postMessage(message, out.map(channel => channel.buffer) as Transferable[]);
  } catch (error) {
    const message: StretchResponse = {
      id,
      kind: 'error',
      message: error instanceof Error ? error.message : 'The track could not be stretched.',
    };
    self.postMessage(message);
  }
};
