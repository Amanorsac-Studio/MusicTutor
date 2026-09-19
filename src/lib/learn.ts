/**
 * The Learn tab's working state: the song being studied, what was heard in it,
 * and its separated stems.
 *
 * It lives here rather than in the page because the work is slow. Hearing the
 * notes takes a while and separating stems takes minutes; a teacher who flips
 * to the Tutorial tab and back should find it still going, or finished, not
 * thrown away with the component.
 */

import { audioEngine } from './audioEngine';
import { learnPlayer } from './player';
import { recogniseChords, type ChordSegment } from './chordTrack';
import { transcribe, type RollNote } from './transcribe';
import type { StemName } from '../types/desktop';

/** What is being listened to: the whole song, or one instrument out of it. */
export type LearnSource = 'mix' | StemName;

export const STEM_LABELS: Record<LearnSource, string> = {
  mix: 'Full song',
  bass: 'Bass',
  piano: 'Keys',
  guitar: 'Guitar',
  vocals: 'Vocals',
  other: 'Other',
  drums: 'Drums',
};

/** The order they are offered in: what a keyboard or bass teacher wants first. */
export const STEM_ORDER: LearnSource[] = ['mix', 'bass', 'piano', 'guitar', 'vocals', 'other', 'drums'];

export type LearnState = {
  fileName: string;
  /** Object URL of the picture, when a video was imported. */
  videoUrl: string | null;
  /** What the page should say is happening, or '' when idle. */
  working: '' | 'Opening the file' | 'Hearing the chords' | 'Hearing the notes';
  progress: number;
  error: string;
  chords: ChordSegment[];
  notes: RollNote[];
  source: LearnSource;
  stems: {
    phase: 'none' | 'downloading' | 'separating' | 'ready';
    progress: number;
    error: string;
  };
};

const initial = (): LearnState => ({
  fileName: '',
  videoUrl: null,
  working: '',
  progress: 0,
  error: '',
  chords: [],
  notes: [],
  source: 'mix',
  stems: { phase: 'none', progress: 0, error: '' },
});

/** Let the page paint before a long synchronous stretch of work. */
const breathe = () => new Promise<void>(resolve => window.setTimeout(resolve, 30));

/** One instrument's line is all tune; a full song's tune is only its top. */
const remark = (notes: RollNote[], source: LearnSource): RollNote[] =>
  (source === 'mix' || source === 'piano' || source === 'guitar' || source === 'other'
    ? notes
    : notes.map(note => ({ ...note, melody: true })));

class LearnSession {
  private current = initial();
  private listeners = new Set<() => void>();
  /** Bumped on every new song, so work for the last one can see it is stale. */
  private generation = 0;
  private mix?: AudioBuffer;
  private stemId = '';
  private buffers = new Map<LearnSource, AudioBuffer>();
  private notesFor = new Map<LearnSource, RollNote[]>();
  private concertPitch = 440;

  get state(): LearnState {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private set(next: Partial<LearnState>): void {
    this.current = { ...this.current, ...next };
    this.listeners.forEach(listener => listener());
  }

  private setStems(next: Partial<LearnState['stems']>): void {
    this.set({ stems: { ...this.current.stems, ...next } });
  }

  /** Open a song or a video and hear what is in it. */
  async open(file: File, concertPitch = 440): Promise<void> {
    this.generation += 1;
    const mine = this.generation;
    this.concertPitch = concertPitch;
    if (this.current.videoUrl) URL.revokeObjectURL(this.current.videoUrl);
    this.buffers.clear();
    this.notesFor.clear();
    this.stemId = '';
    this.mix = undefined;
    this.set({
      ...initial(),
      fileName: file.name.replace(/\.[^.]+$/, ''),
      videoUrl: file.type.startsWith('video/') ? URL.createObjectURL(file) : null,
      working: 'Opening the file',
    });

    try {
      const track = await learnPlayer.load(file);
      if (mine !== this.generation) return;
      const buffer = learnPlayer.audioBuffer;
      if (!buffer) throw new Error('That file has no sound in it.');
      this.mix = buffer;
      this.buffers.set('mix', buffer);

      this.set({ working: 'Hearing the chords', progress: 0 });
      await breathe();
      const chords = recogniseChords(buffer.getChannelData(0), buffer.sampleRate, track.grid.beats, {
        concertPitch,
      });
      if (mine !== this.generation) return;
      this.set({ chords });

      await this.hearNotes('mix', buffer, mine);
    } catch (error) {
      if (mine !== this.generation) return;
      this.set({
        working: '',
        error: error instanceof Error && error.message
          ? error.message
          : 'That file could not be read. Try an MP3, WAV, M4A or MP4.',
      });
    }
  }

  /** Transcribe one source, unless it has been done already. */
  private async hearNotes(source: LearnSource, buffer: AudioBuffer, mine: number): Promise<void> {
    const known = this.notesFor.get(source);
    if (known) {
      this.set({ notes: known, working: '' });
      return;
    }
    this.set({ working: 'Hearing the notes', progress: 0, notes: [] });
    // Drums have no notes to find, and looking only invents some.
    const notes = source === 'drums'
      ? []
      : remark(await transcribe(buffer, fraction => {
        if (mine === this.generation && this.current.source === source) this.set({ progress: fraction });
      }), source);
    if (mine !== this.generation) return;
    this.notesFor.set(source, notes);
    if (this.current.source === source) this.set({ notes, working: '' });
  }

  /** Forget the song. */
  close(): void {
    this.generation += 1;
    if (this.current.videoUrl) URL.revokeObjectURL(this.current.videoUrl);
    learnPlayer.unload();
    this.buffers.clear();
    this.notesFor.clear();
    this.mix = undefined;
    this.set(initial());
  }

  /* ---------------------------------------------------------------- *
   * Stems
   * ---------------------------------------------------------------- */

  /** Split the song into its instruments. Minutes the first time, instant after. */
  async separate(): Promise<void> {
    const desktop = window.pianoTutorDesktop;
    const mix = this.mix;
    if (!mix || this.current.stems.phase === 'downloading' || this.current.stems.phase === 'separating') return;
    if (!desktop?.stemSeparate || !desktop.stemStatus) {
      this.setStems({ error: 'Separating instruments needs the installed desktop app.' });
      return;
    }
    const mine = this.generation;
    const stop = desktop.onStemProgress?.(({ stage, fraction }) => {
      if (mine !== this.generation) return;
      this.setStems({ phase: stage === 'download' ? 'downloading' : 'separating', progress: fraction });
    });

    try {
      this.setStems({ error: '', progress: 0 });
      const status = await desktop.stemStatus();
      if (!status.modelReady) {
        this.setStems({ phase: 'downloading' });
        await desktop.stemDownload?.();
      }
      this.setStems({ phase: 'separating', progress: 0 });

      // The network was trained on 44.1 kHz stereo and hears nothing else well.
      const length = Math.ceil(mix.duration * 44100);
      const offline = new OfflineAudioContext(2, length, 44100);
      const node = offline.createBufferSource();
      node.buffer = mix;
      node.connect(offline.destination);
      node.start();
      const prepared = await offline.startRendering();
      const left = prepared.getChannelData(0).slice();
      const right = prepared.getChannelData(1).slice();

      const result = await desktop.stemSeparate(left.buffer, right.buffer);
      if (mine !== this.generation) return;
      this.stemId = result.id;
      this.setStems({ phase: 'ready', progress: 1 });
    } catch (error) {
      if (mine !== this.generation) return;
      const message = error instanceof Error ? error.message : 'Separation failed.';
      this.setStems({
        phase: 'none', progress: 0,
        // Electron wraps errors from the main process in its own preamble.
        error: message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''),
      });
    } finally {
      stop?.();
    }
  }

  cancelSeparation(): void {
    void window.pianoTutorDesktop?.stemCancel?.();
  }

  /** Switch what is heard and shown: the whole song, or one stem of it. */
  async listenTo(source: LearnSource): Promise<void> {
    const desktop = window.pianoTutorDesktop;
    const track = learnPlayer.state.track;
    if (!track || !this.mix || source === this.current.source) return;
    if (source !== 'mix' && this.current.stems.phase !== 'ready') return;
    const mine = this.generation;

    try {
      let buffer = this.buffers.get(source);
      if (!buffer) {
        if (source === 'mix' || !desktop?.stemRead) return;
        const bytes = await desktop.stemRead(this.stemId, source);
        buffer = await audioEngine.ensure().decodeAudioData(bytes);
        if (mine !== this.generation) return;
        this.buffers.set(source, buffer);
      }
      const wasPlaying = learnPlayer.state.playing;
      const loop = learnPlayer.state.loop;
      // The beat belongs to the song, not to the instrument taken out of it.
      learnPlayer.loadBuffer(buffer, track.name, { tempo: track.tempo, grid: track.grid });
      if (loop) learnPlayer.setLoop(loop);
      if (wasPlaying) learnPlayer.play();
      this.set({ source });
      await this.hearNotes(source, buffer, mine);
    } catch (error) {
      if (mine !== this.generation) return;
      this.set({ working: '', error: error instanceof Error ? error.message : 'That stem could not be opened.' });
    }
  }
}

export const learnSession = new LearnSession();
