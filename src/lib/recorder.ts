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
};

export class LessonRecorder {
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private displayStream?: MediaStream;
  private mixedStream?: MediaStream;
  private startedAt = 0;
  private state: RecorderState = 'idle';
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
   * Begin recording. Requires the desktop shell, which supplies the capture
   * source without a picker dialog.
   */
  async start(options: { quality?: RecordingQuality; recordAudio?: boolean; recordMidi?: boolean } = {}): Promise<void> {
    if (this.state !== 'idle') throw new Error('A recording is already in progress.');
    const quality = options.quality ?? QUALITY_PRESETS['1080p30'];
    const recordAudio = options.recordAudio ?? true;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen capture is not available in this environment.');
    }

    this.state = 'starting';
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: quality.frameRate },
          width: { ideal: quality.width },
          height: { ideal: quality.height },
        },
        audio: false,
      });
      this.displayStream = display;

      const tracks: MediaStreamTrack[] = [...display.getVideoTracks()];

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

      const mimeType = pickMimeType();
      this.recorder = new MediaRecorder(
        this.mixedStream,
        mimeType ? { mimeType, videoBitsPerSecond: quality.videoBitsPerSecond } : undefined,
      );
      this.recorder.ondataavailable = event => {
        if (event.data && event.data.size) this.chunks.push(event.data);
      };
      // If the user stops sharing from the OS overlay, end the recording cleanly.
      display.getVideoTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (this.state === 'recording') void this.stop('Piano_Tutorial').catch(() => {});
        });
      });

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
      return { bytes: 0, durationMs: 0, mimeType: '', midiEvents: 0 };
    }
    this.state = 'stopping';
    const recorder = this.recorder;
    const durationMs = performance.now() - this.startedAt;

    const finished = new Promise<void>(resolve => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
    });
    try { recorder.stop(); } catch { /* already stopped */ }
    await finished;

    const midiEvents = this.midi.recording ? this.midi.stop() : [];
    const mimeType = recorder.mimeType || 'video/webm';
    const blob = new Blob(this.chunks, { type: mimeType });
    const buffer = await blob.arrayBuffer();

    this.cleanup();
    this.state = 'idle';

    const desktop = window.pianoTutorDesktop;
    let videoPath: string | undefined;
    let midiPath: string | undefined;
    if (desktop) {
      const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
      videoPath = await desktop.saveRecording(buffer, name, extension).catch(() => undefined);
      if (midiEvents.length && desktop.saveMidi) {
        const midiBytes = this.midi.build();
        // Copy into a standalone ArrayBuffer for structured-clone over IPC.
        const midiBuffer = midiBytes.slice().buffer as ArrayBuffer;
        midiPath = await desktop.saveMidi(midiBuffer, name).catch(() => undefined);
      }
    }

    return { videoPath, midiPath, bytes: buffer.byteLength, durationMs, mimeType, midiEvents: midiEvents.length };
  }

  /** Abandon a recording without saving. */
  cancel(): void {
    if (this.recorder && this.state === 'recording') {
      try { this.recorder.stop(); } catch { /* noop */ }
    }
    this.midi.stop();
    this.cleanup();
    this.state = 'idle';
  }

  private cleanup(): void {
    this.displayStream?.getTracks().forEach(track => track.stop());
    // The mixed stream's audio tracks belong to the engine's tap and are reused
    // by the next recording, so only the display tracks are stopped above.
    this.displayStream = undefined;
    this.mixedStream = undefined;
    this.recorder = undefined;
    this.chunks = [];
  }
}

export const lessonRecorder = new LessonRecorder();
