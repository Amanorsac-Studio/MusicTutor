/**
 * The shared-lesson file.
 *
 * A lesson is a video and the MIDI that was played while it was recorded, and
 * a teacher needs to send both as one thing. So they are packed into a single
 * file, `.musictutor-lesson`:
 *
 *   8 bytes   "MTLESSON"
 *   1 byte    version (1)
 *   4 bytes   header length, big-endian
 *   n bytes   header, UTF-8 JSON: { name, createdAt, video: {name, type, size}, midi: {size} }
 *   ...       the video's bytes, then the MIDI's
 *
 * Nothing is compressed, because the video already is and the MIDI is a few
 * kilobytes; and nothing is hidden, so the format is easy to read anywhere.
 * The reader lives in src/lib/lessonBundle.ts.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const MAGIC = 'MTLESSON';
const VERSION = 1;
const EXTENSION = '.musictutor-lesson';

const MEDIA_TYPES = {
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
};

/**
 * Write a lesson to disk. The video is streamed rather than read into memory:
 * a recording can be hundreds of megabytes.
 */
async function writeLesson(target, { name, videoPath, midiPath }) {
  const videoStat = await fsp.stat(videoPath);
  const midi = midiPath ? await fsp.readFile(midiPath) : Buffer.alloc(0);
  const extension = path.extname(videoPath).toLowerCase();
  const header = Buffer.from(JSON.stringify({
    name,
    createdAt: new Date().toISOString(),
    video: { name: path.basename(videoPath), type: MEDIA_TYPES[extension] || 'video/webm', size: videoStat.size },
    midi: { size: midi.length },
  }), 'utf8');

  const front = Buffer.alloc(MAGIC.length + 1 + 4);
  front.write(MAGIC, 0, 'ascii');
  front.writeUInt8(VERSION, MAGIC.length);
  front.writeUInt32BE(header.length, MAGIC.length + 1);

  // Written under a temporary name and renamed at the end, so a lesson that is
  // cut off half way never sits there looking finished.
  const partial = `${target}.part`;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(partial);
    out.on('error', reject);
    out.on('finish', resolve);
    out.write(front);
    out.write(header);
    const input = fs.createReadStream(videoPath);
    input.on('error', error => { out.destroy(); reject(error); });
    input.on('end', () => { out.end(midi); });
    input.pipe(out, { end: false });
  }).catch(async error => {
    await fsp.unlink(partial).catch(() => {});
    throw error;
  });
  await fsp.rename(partial, target);
  return target;
}

module.exports = { writeLesson, MAGIC, VERSION, EXTENSION };
