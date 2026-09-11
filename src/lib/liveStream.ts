/**
 * Renderer half of live streaming.
 *
 * Records the composed canvas and the programme mix exactly as the file
 * recorder does, but instead of collecting chunks into a file it hands each one
 * to the desktop shell, which pipes them to ffmpeg for RTMP delivery.
 *
 * Recording and streaming can run at the same time: they are separate
 * MediaRecorder instances over the same tracks.
 */

import { audioEngine } from './audioEngine';
import { sceneCompositor } from './compositor';
import { pickMimeType } from './recorder';
import { bitrateFor, type QualityLevel } from './formats';
import { ingestUrl, type Destination, type StreamStatus, EMPTY_STATUS } from './streaming';

export class LiveStreamer {
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private status: StreamStatus = { ...EMPTY_STATUS };
  private listeners = new Set<(status: StreamStatus) => void>();
  private unsubscribeShell?: () => void;

  subscribe(listener: (status: StreamStatus) => void): () => void {
    this.listeners.add(listener);
    this.attachShell();
    listener(this.status);
    return () => { this.listeners.delete(listener); };
  }

  /** Status changes originate in the main process, where ffmpeg lives. */
  private attachShell(): void {
    if (this.unsubscribeShell) return;
    const desktop = window.pianoTutorDesktop;
    if (!desktop?.onStreamStatus) return;
    this.unsubscribeShell = desktop.onStreamStatus(status => {
      this.status = status;
      // ffmpeg dying is the authoritative end of a stream; stop feeding it.
      if (status.state === 'idle' || status.state === 'error') this.stopRecorder();
      this.publish();
    });
  }

  private publish(): void {
    this.listeners.forEach(listener => {
      try { listener(this.status); } catch { /* a bad listener must not stop the stream */ }
    });
  }

  get current(): StreamStatus {
    return this.status;
  }

  get supported(): boolean {
    return Boolean(window.pianoTutorDesktop?.streamStart);
  }

  async available(): Promise<boolean> {
    const desktop = window.pianoTutorDesktop;
    if (!desktop?.streamAvailable) return false;
    try { return await desktop.streamAvailable(); } catch { return false; }
  }

  /**
   * Go live to every enabled destination.
   *
   * Resolves with an error message when it could not start, or undefined on
   * success. Never throws.
   */
  async start(
    destinations: Destination[],
    options: { frameRate: number; level: QualityLevel },
  ): Promise<string | undefined> {
    const desktop = window.pianoTutorDesktop;
    if (!desktop?.streamStart) return 'Streaming needs the installed desktop app.';
    if (this.recorder) return 'Already streaming.';

    const targets = destinations
      .filter(destination => destination.enabled)
      .map(destination => ({
        id: destination.id,
        name: destination.name,
        url: ingestUrl(destination),
      }))
      .filter(target => target.url);

    if (!targets.length) return 'No destination has both a server and a stream key.';

    try {
      await audioEngine.resume();
      sceneCompositor.start(options.frameRate);
      const size = sceneCompositor.outputSize;

      const canvasStream = sceneCompositor.captureStream(options.frameRate);
      const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
      const audioTracks = audioEngine.recordingStream?.getAudioTracks() ?? [];
      tracks.push(...audioTracks);
      if (!tracks.length) return 'The scene produced no video to stream.';

      this.stream = new MediaStream(tracks);

      const videoBitrate = bitrateFor(size, options.frameRate, options.level);
      const result = await desktop.streamStart(targets, {
        width: size.width,
        height: size.height,
        frameRate: options.frameRate,
        videoBitrate,
        audioBitrate: 160_000,
      });
      if (!result?.ok) {
        this.cleanup();
        return result?.message ?? 'The streamer refused to start.';
      }

      const mimeType = pickMimeType();
      this.recorder = new MediaRecorder(
        this.stream,
        mimeType ? { mimeType, videoBitsPerSecond: videoBitrate, audioBitsPerSecond: 160_000 } : undefined,
      );
      this.recorder.ondataavailable = event => {
        if (!event.data?.size) return;
        // Hand each chunk straight to the shell; nothing is buffered here.
        void event.data.arrayBuffer().then(buffer => {
          window.pianoTutorDesktop?.streamChunk?.(buffer);
        }).catch(() => { /* a dropped chunk is better than a stalled stream */ });
      };
      // Short slices keep latency down and give ffmpeg a steady feed.
      this.recorder.start(250);
      return undefined;
    } catch (error) {
      this.cleanup();
      return error instanceof Error ? error.message : 'Streaming could not start.';
    }
  }

  async stop(): Promise<void> {
    this.stopRecorder();
    try { await window.pianoTutorDesktop?.streamStop?.(); } catch { /* already stopped */ }
  }

  private stopRecorder(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch { /* already stopped */ }
    }
    this.cleanup();
  }

  private cleanup(): void {
    this.recorder = undefined;
    // The tracks belong to the compositor and the engine, and are reused, so
    // they are released rather than stopped.
    this.stream = undefined;
  }
}

export const liveStreamer = new LiveStreamer();
