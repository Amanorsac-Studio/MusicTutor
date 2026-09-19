/**
 * The Learn tab's working state: the song being studied, what was heard in it,
 * and its separated stems.
 *
 * It lives here rather than in the page because the work is slow. Hearing the
 * notes takes a while and separating stems takes minutes; a teacher who flips
 * to the Tutorial tab and back should find it still going, or finished, not
 * thrown away with the component.
 *
 * Two things are kept apart on purpose. What is *heard* is a mix of whichever
 * stems are switched on, so a bass player can mute the bass and play along
 * with the rest of the band. What is *shown* — whose notes are on the roll —
 * is chosen separately, because the part being learned is usually the very
 * one that has been muted.
 */

import { learnPlayer } from './player';
import { estimateKey, recogniseChords, type ChordSegment } from './chordTrack';
import { transcribe, type RollNote } from './transcribe';
import type { StemName } from '../types/desktop';

export const STEM_NAMES: StemName[] = ['bass', 'piano', 'guitar', 'vocals', 'other', 'drums'];

export const STEM_LABELS: Record<StemName, string> = {
  bass: 'Bass',
  piano: 'Keys',
  guitar: 'Guitar',
  vocals: 'Vocals',
  other: 'Other',
  drums: 'Drums',
};

/** Whose notes are on the roll. */
export type NoteView = 'mix' | 'bass' | 'keys' | 'guitar' | 'vocals';

export const VIEW_LABELS: Record<NoteView, string> = {
  mix: 'Full song',
  bass: 'Bass',
  keys: 'Keys',
  guitar: 'Guitar',
  vocals: 'Vocals',
};

/**
 * Which stems each view listens to when finding notes.
 *
 * Keys are heard together with "other": the separation often files pads,
 * organs, synths and part of a piano under "other", and a keyboard part read
 * from the piano stem alone comes out with holes in it.
 */
const VIEW_STEMS: Record<Exclude<NoteView, 'mix'>, StemName[]> = {
  bass: ['bass'],
  keys: ['piano', 'other'],
  guitar: ['guitar'],
  vocals: ['vocals'],
};

export type SongKey = { root: number; mode: 'major' | 'minor' };

export type LearnState = {
  fileName: string;
  /** Object URL of the picture, when a video was imported. */
  videoUrl: string | null;
  /** What the page should say is happening, or '' when idle. */
  working: string;
  progress: number;
  error: string;
  chords: ChordSegment[];
  /** True once the chords have been re-read from the separated bass and keys. */
  chordsFromStems: boolean;
  key: SongKey;
  notes: RollNote[];
  view: NoteView;
  /** Views whose notes have been found already. */
  detected: NoteView[];
  /** Which stems are switched on in what is heard. */
  audible: Record<StemName, boolean>;
  stems: {
    phase: 'none' | 'downloading' | 'separating' | 'loading' | 'ready';
    progress: number;
    error: string;
  };
};

const allOn = (): Record<StemName, boolean> =>
  ({ bass: true, piano: true, guitar: true, vocals: true, other: true, drums: true });

const initial = (): LearnState => ({
  fileName: '',
  videoUrl: null,
  working: '',
  progress: 0,
  error: '',
  chords: [],
  chordsFromStems: false,
  key: { root: 0, mode: 'major' },
  notes: [],
  view: 'mix',
  detected: [],
  audible: allOn(),
  stems: { phase: 'none', progress: 0, error: '' },
});

/** Let the page paint before a long synchronous stretch of work. */
const breathe = () => new Promise<void>(resolve => window.setTimeout(resolve, 30));

const STEM_RATE = 44100;

/**
 * Sum stems into something playable.
 *
 * Stems are held as the 16-bit samples they were stored as and only summed on
 * demand. Six stems of a four-minute song as floating point would be over half
 * a gigabyte; like this they are a quarter of that.
 */
export function mixStems(stems: Int16Array[], channels: 1 | 2): Float32Array[] {
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

class LearnSession {
  private current = initial();
  private listeners = new Set<() => void>();
  /** Bumped on every new song, so work for the last one can see it is stale. */
  private generation = 0;
  private mix?: AudioBuffer;
  private stemData = new Map<StemName, Int16Array>();
  private notesFor = new Map<NoteView, RollNote[]>();
  /** Transcriptions run one at a time; the network is not built to share. */
  private queue: Promise<void> = Promise.resolve();
  private concertPitch = 440;
  private keyChosen = false;

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

  private reset(): void {
    this.generation += 1;
    if (this.current.videoUrl) URL.revokeObjectURL(this.current.videoUrl);
    this.stemData.clear();
    this.notesFor.clear();
    this.mix = undefined;
    this.keyChosen = false;
  }

  /** Open a song or a video and hear what is in it. */
  async open(file: File, concertPitch = 440): Promise<void> {
    this.reset();
    const mine = this.generation;
    this.concertPitch = concertPitch;
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

      this.set({ working: 'Hearing the chords', progress: 0 });
      await breathe();
      const chords = recogniseChords(buffer.getChannelData(0), buffer.sampleRate, track.grid.beats, {
        concertPitch,
      });
      if (mine !== this.generation) return;
      this.set({ chords, key: estimateKey(chords) });

      await this.detect('mix');
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

  /** Forget the song. */
  close(): void {
    this.reset();
    learnPlayer.unload();
    this.set(initial());
  }

  /** Set the key by hand, for when the guess is wrong. */
  setKey(key: SongKey): void {
    this.keyChosen = true;
    this.set({ key });
  }

  /* ---------------------------------------------------------------- *
   * Notes
   * ---------------------------------------------------------------- */

  /** Find the notes of one view, once, queued behind any other in progress. */
  private detect(view: NoteView): Promise<void> {
    const mine = this.generation;
    const run = async () => {
      if (mine !== this.generation || this.notesFor.has(view)) return;
      let buffer: AudioBuffer | undefined;
      if (view === 'mix') buffer = this.mix;
      else {
        const parts = VIEW_STEMS[view].map(stem => this.stemData.get(stem)).filter(Boolean) as Int16Array[];
        if (parts.length) buffer = toBuffer(mixStems(parts, 1));
      }
      if (!buffer) return;

      this.set({ working: `Hearing the ${VIEW_LABELS[view].toLowerCase()} notes`, progress: 0 });
      const heard = await transcribe(buffer, fraction => {
        if (mine === this.generation) this.set({ progress: fraction });
      });
      if (mine !== this.generation) return;
      // One instrument's line is all tune; a band's tune is only its top.
      const notes = view === 'bass' || view === 'vocals'
        ? heard.map(note => ({ ...note, melody: true }))
        : heard;
      this.notesFor.set(view, notes);
      this.set({
        working: '',
        detected: [...this.notesFor.keys()],
        ...(this.current.view === view ? { notes } : {}),
      });
    };
    this.queue = this.queue.then(run).catch(error => {
      if (mine !== this.generation) return;
      this.set({ working: '', error: error instanceof Error ? error.message : 'The notes could not be heard.' });
    });
    return this.queue;
  }

  /**
   * Choose whose notes are on the roll. If they have not been found yet, this
   * is what finds them: nothing but the bass and the keys is read unasked.
   */
  showNotes(view: NoteView): void {
    if (view !== 'mix' && this.current.stems.phase !== 'ready') return;
    this.set({ view, notes: this.notesFor.get(view) ?? [] });
    if (!this.notesFor.has(view)) void this.detect(view);
  }

  /* ---------------------------------------------------------------- *
   * Stems
   * ---------------------------------------------------------------- */

  /** Split the song into its instruments. Minutes the first time, instant after. */
  async separate(): Promise<void> {
    const desktop = window.pianoTutorDesktop;
    const mix = this.mix;
    const phase = this.current.stems.phase;
    if (!mix || (phase !== 'none')) return;
    if (!desktop?.stemSeparate || !desktop.stemStatus || !desktop.stemRead) {
      this.setStems({ error: 'Separating instruments needs the installed desktop app.' });
      return;
    }
    const mine = this.generation;
    const stop = desktop.onStemProgress?.(({ stage, fraction }) => {
      if (mine !== this.generation) return;
      this.setStems({ phase: stage === 'download' ? 'downloading' : 'separating', progress: fraction });
    });

    try {
      this.setStems({ error: '', progress: 0, phase: 'separating' });
      const status = await desktop.stemStatus();
      if (!status.modelReady) {
        this.setStems({ phase: 'downloading' });
        await desktop.stemDownload?.();
      }
      this.setStems({ phase: 'separating', progress: 0 });

      // The network was trained on 44.1 kHz stereo and hears nothing else well.
      const length = Math.ceil(mix.duration * STEM_RATE);
      const offline = new OfflineAudioContext(2, length, STEM_RATE);
      const node = offline.createBufferSource();
      node.buffer = mix;
      node.connect(offline.destination);
      node.start();
      const prepared = await offline.startRendering();
      const left = prepared.getChannelData(0).slice();
      const right = prepared.getChannelData(1).slice();

      const result = await desktop.stemSeparate(left.buffer, right.buffer);
      if (mine !== this.generation) return;

      this.setStems({ phase: 'loading', progress: 0 });
      for (let i = 0; i < STEM_NAMES.length; i += 1) {
        const bytes = await desktop.stemRead(result.id, STEM_NAMES[i]);
        if (mine !== this.generation) return;
        // Past the 44-byte header, a WAV of this kind is nothing but samples.
        this.stemData.set(STEM_NAMES[i], new Int16Array(bytes, 44, Math.floor((bytes.byteLength - 44) / 2)));
        this.setStems({ progress: (i + 1) / STEM_NAMES.length });
      }
      this.setStems({ phase: 'ready', progress: 1 });
      stop?.();

      await this.rehearChords(mine);
      // The two parts people come here to learn are read without being asked.
      void this.detect('bass');
      void this.detect('keys');
    } catch (error) {
      if (mine !== this.generation) return;
      const message = error instanceof Error ? error.message : 'Separation failed.';
      this.stemData.clear();
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

  /**
   * Name the chords again, now that the band can be heard one player at a time:
   * the harmony from the keys, guitar and the rest, the root from the bass, and
   * neither of them through the drums or the singer.
   */
  private async rehearChords(mine: number): Promise<void> {
    const track = learnPlayer.state.track;
    const bass = this.stemData.get('bass');
    // The bass stays in the harmony too: its overtones are part of how a chord
    // sounds, and without them a fading chord is renamed by whatever the tune does.
    const harmony = (['piano', 'guitar', 'other', 'bass'] as StemName[])
      .map(stem => this.stemData.get(stem)).filter(Boolean) as Int16Array[];
    if (!track || !bass || !harmony.length) return;
    this.set({ working: 'Hearing the chords again, from the bass and the keys', progress: 0 });
    await breathe();
    const chords = recogniseChords(mixStems(harmony, 1)[0], STEM_RATE, track.grid.beats, {
      concertPitch: this.concertPitch,
      bassSamples: mixStems([bass], 1)[0],
    });
    if (mine !== this.generation) return;
    // An empty answer means the stems were near silent; keep what there was.
    if (chords.some(segment => segment.root >= 0)) {
      this.set({
        chords, chordsFromStems: true,
        ...(this.keyChosen ? {} : { key: estimateKey(chords) }),
      });
    }
    this.set({ working: '' });
  }

  /** Put the chosen stems into the player, keeping the place, speed and loop. */
  private applyAudible(audible: Record<StemName, boolean>): void {
    const track = learnPlayer.state.track;
    if (!track || !this.mix || this.current.stems.phase !== 'ready') return;
    this.set({ audible });
    const on = STEM_NAMES.filter(stem => audible[stem]);
    const buffer = on.length === STEM_NAMES.length
      // Everything on is the song itself, which is better than the sum of its parts.
      ? this.mix
      : toBuffer(mixStems(on.map(stem => this.stemData.get(stem)).filter(Boolean) as Int16Array[], 2));
    const wasPlaying = learnPlayer.state.playing;
    const loop = learnPlayer.state.loop;
    // The beat belongs to the song, not to whichever players are left in it.
    learnPlayer.loadBuffer(buffer, track.name, { tempo: track.tempo, grid: track.grid });
    if (loop) learnPlayer.setLoop(loop);
    if (wasPlaying) learnPlayer.play();
  }

  /** Switch one stem on or off. */
  toggle(stem: StemName): void {
    this.applyAudible({ ...this.current.audible, [stem]: !this.current.audible[stem] });
  }

  /** Hear one stem alone; asked again of the same stem, bring the band back. */
  solo(stem: StemName): void {
    const audible = this.current.audible;
    const alone = STEM_NAMES.every(name => audible[name] === (name === stem));
    const next = allOn();
    if (!alone) STEM_NAMES.forEach(name => { next[name] = name === stem; });
    this.applyAudible(next);
  }

  everyone(): void {
    this.applyAudible(allOn());
  }
}

export const learnSession = new LearnSession();
