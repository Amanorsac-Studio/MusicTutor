/**
 * Capturing the sound of whatever is playing, so it can be studied the
 * thorough way an imported file is rather than guessed at live.
 *
 * Live chord naming works frame by frame, a fraction of a second at a time,
 * because that is all a live picture ever gets to look at. The analysis an
 * imported song gets is a different thing entirely: it looks at the whole
 * recording at once, tracks the beat, tries two passes and leans on the key
 * it finds. That is what actually answers "the chords aren't accurate" — not
 * a better live guess, but the same deep analysis a file gets.
 *
 * This does not fetch anything from YouTube, or any other site. It records
 * the sound already leaving the speakers, the same way recording a broadcast
 * off a radio or a television always has — no picture is kept, and nothing is
 * downloaded from where the video came from. Whether a particular recording
 * is one somebody is allowed to keep is the same question it always was, and
 * it stays theirs to answer.
 */

export type CaptureHandle = {
  /** Stop recording and resolve with the sound captured, as a compressed clip. */
  stop: () => Promise<Blob>;
};

/**
 * Start capturing the computer's own sound.
 *
 * Windows asks the person what to share; picking a window or the whole screen
 * and ticking "share audio" is what actually grants this. There is no way to
 * skip that picker, on purpose — it is the same permission the live listener
 * asks for.
 */
export async function startCapture(): Promise<CaptureHandle> {
  const media = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (constraints: unknown) => Promise<MediaStream>;
  };
  if (!media.getDisplayMedia) throw new Error('Recording the computer\'s sound needs the installed desktop app.');

  const stream = await media.getDisplayMedia({ video: true, audio: true });
  const audio = stream.getAudioTracks();
  // The picture was only ever a condition of the request.
  stream.getVideoTracks().forEach(track => track.stop());
  if (!audio.length) {
    stream.getTracks().forEach(track => track.stop());
    throw new Error('Windows did not share the system sound. Try again and tick "Share audio".');
  }

  const audioStream = new MediaStream(audio);
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    .find(type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', event => {
    if (event.data.size) chunks.push(event.data);
  });
  // A stray "ended" (the shared window closed, or the source stopped sharing)
  // should not be left recording nothing forever.
  const onEnded = () => { if (recorder.state !== 'inactive') recorder.stop(); };
  audio[0].addEventListener('ended', onEnded);
  recorder.start(1000);

  return {
    stop: () => new Promise(resolve => {
      if (recorder.state === 'inactive') {
        resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
        return;
      }
      recorder.addEventListener('stop', () => {
        audio[0].removeEventListener('ended', onEnded);
        audioStream.getTracks().forEach(track => track.stop());
        resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      }, { once: true });
      recorder.stop();
    }),
  };
}
