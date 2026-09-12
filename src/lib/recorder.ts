/**
 * Lesson recorder.
 *
 * Captures the composed lesson view together with the *program mix* from the
 * audio engine — piano, MIDI instrument and microphones — rather than only the
 * microphone. A piano lesson whose recording contains no piano is not a
 * recording, and that was the previous behaviour.
 */

import { audioEngine } from './audioEngine';
import { MidiRecorder } from './midiFile';
import { sceneCompositor, secondaryCompositor } from './compositor';
import { bitrateFor, type QualityLevel } from './formats';

export type RecordingQuality = {
  width: number;
  height: number;
  frameRate: number;
  videoBitsPerSecond: number;
  label: string;
};

export const QUALITY_PRESETS: Record<string, RecordingQuality> = {
  '720p30': { width: 1280, height: 720, frameRate: 30, videoBitsPerSecond: 4_000_000, label: '720p · 30 fps' },
  '1080p30': { width: 1920, height: 1080, frameRate: 30, videoBitsPerSecond: 8_000_000, label: '1080p · 30 fps' },
  '1080p60': { width: 1920, height: 1080, frameRate: 60, videoBitsPerSecond: 12_000_000, label: '1080p · 60 fps' },
  '2160p30': { width: 3840, height: 2160, frameRate: 30, videoBitsPerSecond: 32_000_000, label: '4K · 30 fps' },
};

/**
 * Preferred container/codec order. WebM/VP9 is checked first for quality, then
 * VP8, then MP4/H.264 where the platform offers it.
 */
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=h264,aac',
  'video/mp4',
];

export function pickMimeType(preferred?: string): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = preferred ? [preferred, ...MIME_CANDIDATES] : MIME_CANDIDATES;
  return candidates.find(type => {
    try { return MediaRecorder.isTypeSupported(type); } catch { return false; }
  });
}

export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping';

export type RecordingResult = {
  videoPath?: string;
  midiPath?: string;
  bytes: number;
  durationMs: number;
  mimeType: string;
  midiEvents: number;
  width: number;
  height: number;
  /** The second shape, when one was recorded alongside. */
  secondPath?: string;
  secondBytes?: number;
  secondWidth?: number;
  secondHeight?: number;
};

export class LessonRecorder {
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private canvasStream?: MediaStream;
  private mixedStream?: MediaStream;

  /**
   * A second take, in the other shape, running alongside the first.
   *
   * The same performance wanted wide and tall is one lesson, not two, so both
   * are captured from the same moment rather than asking the teacher to play it
   * twice. They share the programme audio; only the picture differs.
   */
  private secondRecorder?: MediaRecorder;
  private secondChunks: Blob[] = [];
  private secondStream?: MediaStream;
  private secondSize = { width: 0, height: 0 };
  private secondLabel = '';
  private startedAt = 0;
  private state: RecorderState = 'idle';
  /** Pixel size of the take in progress, for reporting. */
  private outputSize = { width: 0, height: 0 };
  readonly midi = new MidiRecorder();

  get status(): RecorderState {
    return this.state;
  }

  get isRecording(): boolean {
    return this.state === 'recording';
  }

  /** Elapsed recording time in milliseconds. */
  get elapsedMs(): number {
    return this.state === 'recording' ? performance.now() - this.startedAt : 0;
  }

  /**
   * Begin recording the composed scene.
   *
   * Video comes from the scene compositor's canvas, not from a screen grab, so
   * the file contains only the 1920x1080 composition — no panels, no toolbar,
   * and at full resolution however small the window is.
   */
  async start(options: {
    quality?: RecordingQuality;
    /** Bitrate level; combined with the real picture size. */
    level?: QualityLevel;
    frameRate?: number;
    recordAudio?: boolean;
    recordMidi?: boolean;
    /** Also record the other shape, labelled with this format's name. */
    second?: { label: string };
  } = {}): Promise<void> {
    if (this.state !== 'idle') throw new Error('A recording is already in progress.');
    const quality = options.quality ?? QUALITY_PRESETS['1080p30'];
    const frameRate = options.frameRate ?? quality.frameRate;
    const recordAudio = options.recordAudio ?? true;

    if (typeof MediaRecorder === 'undefined') {
      throw new Error('Recording is not available in this environment.');
    }

    this.state = 'starting';
    try {
      // Keep the compositor painting at the recording frame rate for the
      // duration of the take.
      sceneCompositor.start(frameRate);
      const canvasStream = sceneCompositor.captureStream(frameRate);
      const videoTracks = canvasStream.getVideoTracks();
      if (!videoTracks.length) throw new Error('The scene canvas produced no video.');
      this.canvasStream = canvasStream;

      const tracks: MediaStreamTrack[] = [...videoTracks];

      if (recordAudio) {
        // The engine's recording tap already carries the full program mix:
        // built-in instrument, MIDI instrument and every live input channel.
        await audioEngine.resume();
        const program = audioEngine.recordingStream;
        const audioTracks = program?.getAudioTracks() ?? [];
        if (!audioTracks.length) {
          console.warn('[recorder] no program audio available; recording video only');
        }
        tracks.push(...audioTracks);
      }

      this.mixedStream = new MediaStream(tracks);
      this.chunks = [];

      // Budget the bitrate from the picture actually being produced rather than
      // a fixed table, so quality holds at any format and resolution.
      const size = sceneCompositor.outputSize;
      const videoBitsPerSecond = options.level
        ? bitrateFor(size, frameRate, options.level)
        : quality.videoBitsPerSecond;

      const mimeType = pickMimeType();
      this.recorder = new MediaRecorder(
        this.mixedStream,
        mimeType
          ? { mimeType, videoBitsPerSecond, audioBitsPerSecond: 256_000 }
          : undefined,
      );
      this.outputSize = size;
      this.recorder.ondataavailable = event => {
        if (event.data && event.data.size) this.chunks.push(event.data);
      };

      // The second shape, when one is wanted. It is started first so both
      // recorders begin within a frame of each other.
      if (options.second && secondaryCompositor.running) {
        const secondCanvas = secondaryCompositor.captureStream(frameRate);
        const secondVideo = secondCanvas.getVideoTracks();
        if (secondVideo.length) {
          const secondTracks: MediaStreamTrack[] = [...secondVideo];
          if (recordAudio) {
            secondTracks.push(...(audioEngine.recordingStream?.getAudioTracks() ?? []));
          }
          this.secondStream = secondCanvas;
          this.secondSize = secondaryCompositor.outputSize;
          this.secondLabel = options.second.label;
          this.secondChunks = [];
          const secondBitrate = options.level
            ? bitrateFor(this.secondSize, frameRate, options.level)
            : quality.videoBitsPerSecond;
          this.secondRecorder = new MediaRecorder(
            new MediaStream(secondTracks),
            mimeType
              ? { mimeType, videoBitsPerSecond: secondBitrate, audioBitsPerSecond: 256_000 }
              : undefined,
          );
          this.secondRecorder.ondataavailable = event => {
            if (event.data && event.data.size) this.secondChunks.push(event.data);
          };
          this.secondRecorder.start(1000);
        }
      }

      this.recorder.start(1000);
      this.startedAt = performance.now();
      if (options.recordMidi ?? true) this.midi.start(this.startedAt);
      this.state = 'recording';
    } catch (error) {
      this.cleanup();
      this.state = 'idle';
      throw error;
    }
  }

  /**
   * Stop and persist. Returns the saved paths when running in the desktop
   * shell; in a browser it returns byte counts without paths.
   */
  async stop(name: string): Promise<RecordingResult> {
    if (this.state !== 'recording' || !this.recorder) {
      return { bytes: 0, durationMs: 0, mimeType: '', midiEvents: 0, width: 0, height: 0 };
    }
    this.state = 'stopping';
    const recorder = this.recorder;
    const durationMs = performance.now() - this.startedAt;

    const finished = new Promise<void>(resolve => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
    });
    try { recorder.stop(); } catch { /* already stopped */ }
    await finished;

    // Stop the second take alongside the first, so the two end together.
    const second = this.secondRecorder;
    const secondFinished = second
      ? new Promise<void>(resolve => {
        second.addEventListener('stop', () => resolve(), { once: true });
        try { second.stop(); } catch { resolve(); }
      })
      : Promise.resolve();
    await secondFinished;

    const midiEvents = this.midi.recording ? this.midi.stop() : [];
    const mimeType = recorder.mimeType || 'video/webm';
    const blob = new Blob(this.chunks, { type: mimeType });
    const buffer = await blob.arrayBuffer();
    const secondBlob = this.secondChunks.length
      ? new Blob(this.secondChunks, { type: mimeType })
      : undefined;
    const secondBuffer = secondBlob ? await secondBlob.arrayBuffer() : undefined;
    const secondLabel = this.secondLabel;
    const secondSize = { ...this.secondSize };

    this.cleanup();
    this.state = 'idle';

    const desktop = window.pianoTutorDesktop;
    let videoPath: string | undefined;
    let secondPath: string | undefined;
    let midiPath: string | undefined;
    if (desktop) {
      const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
      videoPath = await desktop.saveRecording(buffer, name, extension).catch(() => undefined);
      if (secondBuffer) {
        // Named by shape, so the two files are never confused for takes.
        secondPath = await desktop
          .saveRecording(secondBuffer, `${name}_${secondLabel}`, extension)
          .catch(() => undefined);
      }
      if (midiEvents.length && desktop.saveMidi) {
        const midiBytes = this.midi.build();
        // Copy into a standalone ArrayBuffer for structured-clone over IPC.
        const midiBuffer = midiBytes.slice().buffer as ArrayBuffer;
        midiPath = await desktop.saveMidi(midiBuffer, name).catch(() => undefined);
      }
    }

    return {
      videoPath, midiPath, bytes: buffer.byteLength, durationMs, mimeType,
      midiEvents: midiEvents.length,
      width: this.outputSize.width, height: this.outputSize.height,
      secondPath,
      secondBytes: secondBuffer?.byteLength,
      secondWidth: secondSize.width || undefined,
      secondHeight: secondSize.height || undefined,
    };
  }

  /** Abandon a recording without saving. */
  cancel(): void {
    if (this.recorder && this.state === 'recording') {
      try { this.recorder.stop(); } catch { /* noop */ }
    }
    if (this.secondRecorder) {
      try { this.secondRecorder.stop(); } catch { /* noop */ }
    }
    this.midi.stop();
    this.cleanup();
    this.state = 'idle';
  }

  private cleanup(): void {
    this.secondStream?.getVideoTracks().forEach(track => track.stop());
    this.secondStream = undefined;
    this.secondRecorder = undefined;
    this.secondChunks = [];
    this.canvasStream?.getTracks().forEach(track => track.stop());
    // The mixed stream's audio tracks belong to the engine's tap and are reused
    // by the next recording, so only the canvas tracks are stopped above. The
    // compositor itself keeps running to drive the live preview.
    this.canvasStream = undefined;
    this.mixedStream = undefined;
    this.recorder = undefined;
    this.chunks = [];
  }
}

export const lessonRecorder = new LessonRecorder();
