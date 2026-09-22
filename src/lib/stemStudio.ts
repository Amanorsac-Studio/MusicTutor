/**
 * The Stems tab's working state: one imported song, split into its instruments.
 *
 * This is the same HT-Demucs separation the Learn tab uses, but on its own —
 * no chords, no notes, no piano roll. Import a song, split it, then mute, solo
 * and download whichever parts are wanted. Nothing here waits on the analysis
 * Learn does, so this is the fast path when all that is wanted is the stems.
 */

import { audioEngine } from './audioEngine';
import { stemsPlayer } from './player';
import type { StemName } from '../types/desktop';

/** The order stems are shown in, drums first as the rhythmic anchor. */
export const STEM_ORDER: StemName[] = ['drums', 'bass', 'guitar', 'piano', 'vocals', 'other'];

export const STEM_LABELS: Record<StemName, string> = {
  drums: 'Drums',
  bass: 'Bass',
  guitar: 'Guitar',
  piano: 'Keys',
  vocals: 'Vocals',
  other: 'Aux',
};

const STEM_RATE = 44100;

export type StemsPhase = 'none' | 'downloading' | 'separating' | 'loading' | 'ready';

export type StemStudioState = {
  fileName: string;
  duration: number;
  error: string;
  phase: StemsPhase;
  progress: number;
  songId: string;
  audible: Record<StemName, boolean>;
};

const allOn = (): Record<StemName, boolean> =>
  ({ drums: true, bass: true, guitar: true, piano: true, vocals: true, other: true });

const initial = (): StemStudioState => ({
  fileName: '', duration: 0, error: '', phase: 'none', progress: 0, songId: '', audible: allOn(),
});

/** Sum stems, held as 16-bit samples, into playable stereo floats. */
function mixStems(stems: Int16Array[], channels: 1 | 2): Float32Array[] {
  const frames = stems.length ? Math.floor(stems[0].length / 2) : 0;
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  stems.forEach(samples => {
    if (channels === 2) {
      const [left, right] = out;
      for (let i = 0; i < frames; i += 1) {
        left[i] += samples[i * 2] / 32768;
        right[i] += samples[i * 2 + 1] / 32768;
      }
    } else {
      const mono = out[0];
      for (let i = 0; i < frames; i += 1) mono[i] += (samples[i * 2] + samples[i * 2 + 1]) / 65536;
    }
  });
  return out;
}

const toBuffer = (channels: Float32Array[]): AudioBuffer => {
  const buffer = new AudioBuffer({
    length: Math.max(1, channels[0].length), numberOfChannels: channels.length, sampleRate: STEM_RATE,
  });
  channels.forEach((data, index) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, index));
  return buffer;
};

/** Trigger a save-as-file download of one stem's WAV bytes. */
function downloadWav(bytes: ArrayBuffer, name: string): void {
  const blob = new Blob([bytes], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name.endsWith('.wav') ? name : `${name}.wav`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

class StemStudio {
  private current = initial();
  private listeners = new Set<() => void>();
  private generation = 0;
  private stemData = new Map<StemName, Int16Array>();

  get state(): StemStudioState {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private set(next: Partial<StemStudioState>): void {
    this.current = { ...this.current, ...next };
    this.listeners.forEach(listener => listener());
  }

  /** Import a song and get it ready to split. */
  async open(file: File): Promise<void> {
    this.generation += 1;
    const mine = this.generation;
    this.stemData.clear();
    stemsPlayer.unload();
    this.set({ ...initial(), fileName: file.name.replace(/\.[^.]+$/, '') });

    try {
      const bytes = await file.arrayBuffer();
      const decoded = await audioEngine.ensure().decodeAudioData(bytes);
      if (mine !== this.generation) return;
      stemsPlayer.loadBuffer(decoded, file.name.replace(/\.[^.]+$/, ''));
      this.set({ duration: decoded.duration });
    } catch {
      if (mine !== this.generation) return;
      this.set({ error: 'That file could not be read. Try an MP3, WAV, M4A or MP4.' });
    }
  }

  /** Split the imported song into its six instruments. */
  async separate(): Promise<void> {
    const desktop = window.pianoTutorDesktop;
    const source = stemsPlayer.audioBuffer;
    if (!source || this.current.phase !== 'none') return;
    if (!desktop?.stemSeparate || !desktop.stemStatus || !desktop.stemRead) {
      this.set({ error: 'Separating instruments needs the installed desktop app.' });
      return;
    }
    const mine = this.generation;
    const stop = desktop.onStemProgress?.(({ stage, fraction }) => {
      if (mine !== this.generation) return;
      this.set({ phase: stage === 'download' ? 'downloading' : 'separating', progress: fraction });
    });

    try {
      this.set({ error: '', progress: 0, phase: 'separating' });
      const status = await desktop.stemStatus();
      if (!status.modelReady) {
        this.set({ phase: 'downloading' });
        await desktop.stemDownload?.();
      }
      this.set({ phase: 'separating', progress: 0 });

      // The network was trained on 44.1 kHz stereo and hears nothing else well.
      const length = Math.ceil(source.duration * STEM_RATE);
      const offline = new OfflineAudioContext(2, length, STEM_RATE);
      const node = offline.createBufferSource();
      node.buffer = source;
      node.connect(offline.destination);
      node.start();
      const prepared = await offline.startRendering();
      const left = prepared.getChannelData(0).slice();
      const right = prepared.getChannelData(1).slice();

      const result = await desktop.stemSeparate(left.buffer, right.buffer);
      if (mine !== this.generation) return;
      this.set({ songId: result.id });

      this.set({ phase: 'loading', progress: 0 });
      for (let i = 0; i < STEM_ORDER.length; i += 1) {
        const stemBytes = await desktop.stemRead(result.id, STEM_ORDER[i]);
        if (mine !== this.generation) return;
        // Past the 44-byte header, a WAV of this kind is nothing but samples.
        this.stemData.set(STEM_ORDER[i], new Int16Array(stemBytes, 44, Math.floor((stemBytes.byteLength - 44) / 2)));
        this.set({ progress: (i + 1) / STEM_ORDER.length });
      }
      this.applyAudible(allOn());
      this.set({ phase: 'ready', progress: 1 });
    } catch (error) {
      if (mine !== this.generation) return;
      this.stemData.clear();
      const message = error instanceof Error ? error.message : 'Separation failed.';
      this.set({
        phase: 'none', progress: 0,
        // Electron wraps errors from the main process in its own preamble.
        error: message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''),
      });
    } finally {
      stop?.();
    }
  }

  cancel(): void {
    void window.pianoTutorDesktop?.stemCancel?.();
  }

  /** Put the chosen stems into the player, keeping the place and loop. */
  private applyAudible(audible: Record<StemName, boolean>): void {
    if (this.current.phase !== 'ready' && this.stemData.size < STEM_ORDER.length) {
      // Still separating; just remember the choice for when it lands.
      this.set({ audible });
      return;
    }
    this.set({ audible });
    const on = STEM_ORDER.filter(stem => audible[stem]);
    const parts = on.map(stem => this.stemData.get(stem)).filter(Boolean) as Int16Array[];
    if (!parts.length) return;
    const buffer = toBuffer(mixStems(parts, 2));
    const wasPlaying = stemsPlayer.state.playing;
    const loop = stemsPlayer.state.loop;
    stemsPlayer.loadBuffer(buffer, this.current.fileName);
    if (loop) stemsPlayer.setLoop(loop);
    if (wasPlaying) stemsPlayer.play();
  }

  toggle(stem: StemName): void {
    this.applyAudible({ ...this.current.audible, [stem]: !this.current.audible[stem] });
  }

  /** Hear one stem alone; asked again of the same stem, bring the band back. */
  solo(stem: StemName): void {
    const audible = this.current.audible;
    const alone = STEM_ORDER.every(name => audible[name] === (name === stem));
    const next = allOn();
    if (!alone) STEM_ORDER.forEach(name => { next[name] = name === stem; });
    this.applyAudible(next);
  }

  everyone(): void {
    this.applyAudible(allOn());
  }

  /** Save one separated stem to disk, as a WAV file. */
  async download(stem: StemName): Promise<void> {
    const desktop = window.pianoTutorDesktop;
    if (!desktop?.stemRead || !this.current.songId) return;
    try {
      const bytes = await desktop.stemRead(this.current.songId, stem);
      downloadWav(bytes, `${this.current.fileName} - ${STEM_LABELS[stem]}`);
    } catch {
      this.set({ error: 'That stem could not be saved.' });
    }
  }

  /** Save every stem, one file each. */
  async downloadAll(): Promise<void> {
    for (const stem of STEM_ORDER) await this.download(stem);
  }

  close(): void {
    this.generation += 1;
    this.stemData.clear();
    stemsPlayer.unload();
    this.set(initial());
  }
}

export const stemStudio = new StemStudio();
