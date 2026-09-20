/**
 * Opening a shared lesson.
 *
 * The file is written by electron/lessonBundle.cjs; the layout is described
 * there. Reading works on a Blob and slices out only what it needs, so a
 * lesson with a long video is not pulled into memory just to look inside it.
 */

export const LESSON_EXTENSION = '.musictutor-lesson';

const MAGIC = 'MTLESSON';
const FRONT = MAGIC.length + 1 + 4;

export type LessonHeader = {
  name: string;
  createdAt?: string;
  video: { name: string; type: string; size: number };
  midi: { size: number };
};

export type Lesson = {
  name: string;
  /** The recording, ready to hand to a player. */
  video: Blob;
  /** The MIDI that was played during it, or null for a lesson without any. */
  midi: Uint8Array | null;
};

export const isLessonFile = (name: string): boolean => name.toLowerCase().endsWith(LESSON_EXTENSION);

/** Read a lesson file apart. Says plainly what is wrong with one that will not open. */
export async function readLesson(file: Blob): Promise<Lesson> {
  if (file.size < FRONT) throw new Error('That is not a MusicTutor lesson.');
  const front = new Uint8Array(await file.slice(0, FRONT).arrayBuffer());
  const magic = String.fromCharCode(...front.slice(0, MAGIC.length));
  if (magic !== MAGIC) throw new Error('That is not a MusicTutor lesson.');
  const version = front[MAGIC.length];
  if (version > 1) throw new Error('This lesson was made by a newer MusicTutor. Update the app to open it.');

  const headerLength = new DataView(front.buffer).getUint32(MAGIC.length + 1);
  if (headerLength <= 0 || FRONT + headerLength > file.size) throw new Error('This lesson file is damaged.');
  let header: LessonHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(await file.slice(FRONT, FRONT + headerLength).arrayBuffer()));
  } catch {
    throw new Error('This lesson file is damaged.');
  }
  const videoSize = Number(header.video?.size);
  const midiSize = Number(header.midi?.size ?? 0);
  if (!Number.isFinite(videoSize) || videoSize <= 0 || FRONT + headerLength + videoSize + midiSize > file.size) {
    throw new Error('This lesson file is incomplete. It may not have finished copying.');
  }

  const videoStart = FRONT + headerLength;
  const video = file.slice(videoStart, videoStart + videoSize, header.video.type || 'video/webm');
  const midi = midiSize > 0
    ? new Uint8Array(await file.slice(videoStart + videoSize, videoStart + videoSize + midiSize).arrayBuffer())
    : null;
  return { name: String(header.name || 'Shared lesson'), video, midi };
}
