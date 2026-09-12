/**
 * Renderer half of live streaming.
 *
 * Records the composed canvas and the programme mix exactly as the file
 * recorder does, but instead of collecting chunks into a file it hands each one
 * to the desktop shell, which pipes them to ffmpeg for RTMP delivery.
 *
 * Both shapes can be live at once — wide to YouTube and tall to TikTok from the
 * same performance. They cannot share an encode, because they are different
 * pictures, so each has its own recorder here and its own ffmpeg in the shell.
 * They do share the programme audio.
 *
 * Recording and streaming can also run together: they are separate
 * MediaRecorder instances over the same tracks.
 */

import { audioEngine } from './audioEngine';
import { sceneCompositor, secondaryCompositor } from './compositor';
import { pickMimeType } from './recorder';
import { bitrateFor, type QualityLevel } from './formats';
import { ingestUrl, type Destination, type StreamStatus, EMPTY_STATUS } from './streaming';

/** Which composed shape an encoder is carrying. */
export type StreamOutput = 'primary' | 'secondary';

export const STREAM_OUTPUTS: StreamOutput[] = ['primary', 'secondary'];

export class LiveStreamer {
  private recorders = new Map<StreamOutput, MediaRecorder>();
  private streams = new Map<StreamOutput, MediaStream>();
  private statuses = new Map<StreamOutput, StreamStatus>();
  private listeners = new Set<(status: StreamStatus) => void>();
  private unsubscribeShell?: () => void;

  subscribe(listener: (status: StreamStatus) => void): () => void {
    this.listeners.add(listener);
    this.attachShell();
    listener(this.current);
    return () => { this.listeners.delete(listener); };
  }

  /** Status changes originate in the main process, where ffmpeg lives. */
  private attachShell(): void {
    if (this.unsubscribeShell) return;
    const desktop = window.pianoTutorDesktop;
    if (!desktop?.onStreamStatus) return;
    this.unsubscribeShell = desktop.onStreamStatus(status => {
      const output = ((status as StreamStatus & { output?: StreamOutput }).output ?? 'primary');
      this.statuses.set(output, status);
      // ffmpeg dying is the authoritative end of a stream; stop feeding it.
      if (status.state === 'idle' || status.state === 'error') this.stopRecorder(output);
      this.publish();
    });
  }

  private publish(): void {
    const merged = this.current;
    this.listeners.forEach(listener => {
      try { listener(merged); } catch { /* a bad listener must not stop the stream */ }
    });
  }

  /** One output's own status. */
  statusFor(output: StreamOutput): StreamStatus {
    return this.statuses.get(output) ?? { ...EMPTY_STATUS };
  }

  /**
   * The two outputs seen as one, for the transport and the header.
   *
   * Live if either is live, with the destinations of both together: what a
   * teacher needs to know is that they are on air, not which encoder carries it.
   */
  get current(): StreamStatus {
    const all = [...this.statuses.values()];
    if (!all.length) return { ...EMPTY_STATUS };
    const leading = all.find(item => item.state === 'live')
      ?? all.find(item => item.state === 'starting')
      ?? all.find(item => item.state === 'error')
      ?? all[0];
    return {
      ...leading,
      destinations: all.flatMap(item => item.destinations),
      bytesSent: all.reduce((total, item) => total + item.bytesSent, 0),
    };
  }

  /** Whether a given shape is currently being encoded here. */
  isRunning(output: StreamOutput): boolean {
    return this.recorders.has(output);
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
   * Go live to every enabled destination of one shape.
   *
   * Resolves with an error message when it could not start, or undefined on
   * success. Never throws.
   */
  async start(
    destinations: Destination[],
    options: { frameRate: number; level: QualityLevel; output?: StreamOutput },
  ): Promise<string | undefined> {
    const output = options.output ?? 'primary';
    const desktop = window.pianoTutorDesktop;
    if (!desktop?.streamStart) return 'Streaming needs the installed desktop app.';
    if (this.recorders.has(output)) return 'Already streaming.';

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
      const compositor = output === 'secondary' ? secondaryCompositor : sceneCompositor;
      if (output === 'secondary' && !compositor.running) {
        return 'Switch on the second shape in the Tutorial tab before streaming it.';
      }
      compositor.start(options.frameRate);
      const size = compositor.outputSize;

      const canvasStream = compositor.captureStream(options.frameRate);
      const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
      tracks.push(...(audioEngine.recordingStream?.getAudioTracks() ?? []));
      if (!tracks.length) return 'The scene produced no video to stream.';

      const stream = new MediaStream(tracks);
      this.streams.set(output, stream);

      const videoBitrate = bitrateFor(size, options.frameRate, options.level);
      const result = await desktop.streamStart(targets, {
        width: size.width,
        height: size.height,
        frameRate: options.frameRate,
        videoBitrate,
        audioBitrate: 160_000,
        output,
      });
      if (!result?.ok) {
        this.cleanup(output);
        return result?.message ?? 'The streamer refused to start.';
      }

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType, videoBitsPerSecond: videoBitrate, audioBitsPerSecond: 160_000 } : undefined,
      );
      recorder.ondataavailable = event => {
        if (!event.data?.size) return;
        // Hand each chunk straight to the shell; nothing is buffered here.
        void event.data.arrayBuffer().then(buffer => {
          window.pianoTutorDesktop?.streamChunk?.(buffer, output);
        }).catch(() => { /* a dropped chunk is better than a stalled stream */ });
      };
      // Short slices keep latency down and give ffmpeg a steady feed.
      recorder.start(250);
      this.recorders.set(output, recorder);
      return undefined;
    } catch (error) {
      this.cleanup(output);
      return error instanceof Error ? error.message : 'Streaming could not start.';
    }
  }

  /** Stop one shape, or both when none is named. */
  async stop(output?: StreamOutput): Promise<void> {
    const outputs = output ? [output] : STREAM_OUTPUTS;
    outputs.forEach(item => this.stopRecorder(item));
    try {
      await window.pianoTutorDesktop?.streamStop?.(output);
    } catch { /* already stopped */ }
  }

  private stopRecorder(output: StreamOutput): void {
    const recorder = this.recorders.get(output);
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* already stopped */ }
    }
    this.cleanup(output);
  }

  private cleanup(output: StreamOutput): void {
    this.recorders.delete(output);
    // The tracks belong to the compositor and the engine, and are reused, so
    // they are released rather than stopped.
    this.streams.delete(output);
  }
}

export const liveStreamer = new LiveStreamer();
