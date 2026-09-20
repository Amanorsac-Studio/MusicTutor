import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLessonFile, readLesson } from './lessonBundle';

// The writer is CommonJS in the desktop shell; the reader is the app's. Reading
// what the real writer wrote is the only test that means anything.
const { writeLesson } = createRequire(import.meta.url)('../../electron/lessonBundle.cjs') as {
  writeLesson: (target: string, input: { name: string; videoPath: string; midiPath?: string }) => Promise<string>;
};

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-'));
const write = (name: string, bytes: Uint8Array) => {
  const file = path.join(folder, name);
  fs.writeFileSync(file, bytes);
  return file;
};
const asBlob = (file: string) => new Blob([fs.readFileSync(file)]);

const VIDEO = new Uint8Array(5000).map((_, i) => (i * 7) % 251);
const MIDI = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

describe('lesson file', () => {
  it('gives back the video and the MIDI exactly as they went in', async () => {
    const video = write('take.webm', VIDEO);
    const midi = write('take.mid', MIDI);
    const target = await writeLesson(path.join(folder, 'a.musictutor-lesson'), { name: 'Scales, week 3', videoPath: video, midiPath: midi });
    const lesson = await readLesson(asBlob(target));
    expect(lesson.name).toBe('Scales, week 3');
    expect(new Uint8Array(await lesson.video.arrayBuffer())).toEqual(VIDEO);
    expect(lesson.video.type).toBe('video/webm');
    expect(lesson.midi).toEqual(MIDI);
  });

  it('carries a lesson that has no MIDI', async () => {
    const video = write('quiet.webm', VIDEO);
    const target = await writeLesson(path.join(folder, 'b.musictutor-lesson'), { name: 'Just talking', videoPath: video });
    const lesson = await readLesson(asBlob(target));
    expect(lesson.midi).toBeNull();
    expect(lesson.video.size).toBe(VIDEO.length);
  });

  it('never leaves a half-written file behind', async () => {
    await expect(writeLesson(path.join(folder, 'c.musictutor-lesson'), {
      name: 'x', videoPath: path.join(folder, 'missing.webm'),
    })).rejects.toThrow();
    expect(fs.existsSync(path.join(folder, 'c.musictutor-lesson'))).toBe(false);
    expect(fs.existsSync(path.join(folder, 'c.musictutor-lesson.part'))).toBe(false);
  });

  it('says so plainly when the file is not a lesson', async () => {
    await expect(readLesson(new Blob(['this is just some text, not a lesson at all']))).rejects.toThrow(/not a MusicTutor lesson/);
    await expect(readLesson(new Blob(['tiny']))).rejects.toThrow(/not a MusicTutor lesson/);
  });

  it('says so when a lesson was cut off while copying', async () => {
    const video = write('long.webm', VIDEO);
    const target = await writeLesson(path.join(folder, 'd.musictutor-lesson'), {
      name: 'x', videoPath: video, midiPath: write('long.mid', MIDI),
    });
    const whole = fs.readFileSync(target);
    await expect(readLesson(new Blob([whole.slice(0, whole.length - 200)]))).rejects.toThrow(/incomplete/);
  });

  it('says so when the header is damaged', async () => {
    const video = write('bad.webm', VIDEO);
    const target = await writeLesson(path.join(folder, 'e.musictutor-lesson'), { name: 'x', videoPath: video });
    const bytes = new Uint8Array(fs.readFileSync(target));
    bytes[20] = 0x7f; // inside the JSON header
    bytes[21] = 0x7f;
    await expect(readLesson(new Blob([bytes]))).rejects.toThrow(/damaged/);
  });

  it('turns away a lesson from a newer version rather than misreading it', async () => {
    const video = write('new.webm', VIDEO);
    const target = await writeLesson(path.join(folder, 'f.musictutor-lesson'), { name: 'x', videoPath: video });
    const bytes = new Uint8Array(fs.readFileSync(target));
    bytes[8] = 2;
    await expect(readLesson(new Blob([bytes]))).rejects.toThrow(/newer MusicTutor/);
  });

  it('recognises lesson files by name', () => {
    expect(isLessonFile('Week 3.musictutor-lesson')).toBe(true);
    expect(isLessonFile('WEEK 3.MUSICTUTOR-LESSON')).toBe(true);
    expect(isLessonFile('song.mp3')).toBe(false);
  });
});
