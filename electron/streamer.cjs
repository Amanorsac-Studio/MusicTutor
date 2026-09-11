/**
 * RTMP streaming, run in the main process.
 *
 * Chromium cannot speak RTMP, so the renderer records the composed canvas and
 * the programme mix to WebM and pipes the chunks here. One ffmpeg process
 * transcodes to H.264/AAC and fans the result out to every destination through
 * the tee muxer, so three destinations cost one encode rather than three.
 *
 * Stream keys pass through this module. They are never logged: only the ingest
 * host is ever written to the console or sent back to the renderer.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/** Locate the bundled ffmpeg, both unpacked in development and inside an asar. */
function ffmpegPath() {
  let resolved;
  try {
    resolved = require('ffmpeg-static');
  } catch {
    return null;
  }
  if (!resolved) return null;
  // electron-builder unpacks native binaries beside the asar archive.
  const unpacked = resolved.replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(unpacked)) return unpacked;
  return fs.existsSync(resolved) ? resolved : null;
}

/** Host of an ingest URL, safe to log. Never returns the key. */
function safeHost(url) {
  const match = /^(rtmps?:\/\/[^/]+)/i.exec(String(url || ''));
  return match ? match[1] : '(unknown host)';
}

class Streamer {
  /**
   * @param logPath where to record ffmpeg's own output. Streaming failures are
   *   nearly always explained by ffmpeg's stderr, and a user cannot read a
   *   console, so it is kept on disk. Stream keys never appear in it.
   */
  constructor(logPath) {
    this.logPath = logPath || null;
    this.process = null;
    this.state = 'idle';
    this.message = '';
    this.startedAt = 0;
    this.bytesSent = 0;
    this.destinations = [];
    this.onStatus = null;
    this.recentErrors = [];
  }

  log(line) {
    if (!this.logPath) return;
    try {
      fs.appendFileSync(this.logPath, `[${new Date().toISOString()}] ${line}
`);
    } catch { /* logging must never break streaming */ }
  }

  available() {
    return Boolean(ffmpegPath());
  }

  status() {
    return {
      state: this.state,
      destinations: this.destinations,
      message: this.message,
      uptime: this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0,
      bytesSent: this.bytesSent,
    };
  }

  publish() {
    if (this.onStatus) {
      try { this.onStatus(this.status()); } catch { /* renderer may have gone */ }
    }
  }

  /**
   * Start pushing.
   *
   * @param targets [{ id, name, url }] — url includes the stream key.
   * @param options { width, height, frameRate, videoBitrate, audioBitrate }
   */
  start(targets, options = {}) {
    if (this.process) return { ok: false, message: 'A stream is already running.' };

    const binary = ffmpegPath();
    if (!binary) return { ok: false, message: 'The bundled ffmpeg could not be found.' };

    const live = (targets || []).filter(target => target && target.url);
    if (!live.length) return { ok: false, message: 'No destination has a server and key.' };

    const frameRate = Math.max(1, Math.round(options.frameRate || 30));
    const videoBitrate = Math.max(500_000, Math.round(options.videoBitrate || 6_000_000));
    const audioBitrate = Math.max(64_000, Math.round(options.audioBitrate || 160_000));

    // Each output is wrapped as FLV, which is what RTMP carries. onfail=ignore
    // keeps the remaining destinations alive if one refuses the connection.
    const tee = live
      .map(target => `[f=flv:onfail=ignore]${target.url}`)
      .join('|');

    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      // The renderer feeds a live WebM stream on stdin.
      '-i', 'pipe:0',

      // The tee muxer will not infer its streams: without explicit mapping it
      // reports "Output file does not contain any stream" and refuses to open
      // anything. The trailing ? on the audio map keeps a video-only scene
      // working, for when audio recording is switched off.
      '-map', '0:v:0',
      '-map', '0:a:0?',

      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-profile:v', 'main',
      '-pix_fmt', 'yuv420p',
      '-b:v', String(videoBitrate),
      '-maxrate', String(videoBitrate),
      '-bufsize', String(videoBitrate * 2),
      // A keyframe every two seconds, which every platform asks for.
      '-g', String(frameRate * 2),
      '-keyint_min', String(frameRate),
      '-sc_threshold', '0',
      '-r', String(frameRate),

      '-c:a', 'aac',
      '-b:a', String(audioBitrate),
      '-ar', '44100',
      '-ac', '2',

      '-f', 'tee',
      tee,
    ];

    try {
      this.process = spawn(binary, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (error) {
      this.state = 'error';
      this.message = `ffmpeg could not be started: ${error.message}`;
      this.publish();
      return { ok: false, message: this.message };
    }

    this.state = 'starting';
    this.message = '';
    this.bytesSent = 0;
    this.startedAt = Date.now();
    this.destinations = live.map(target => target.name || safeHost(target.url));
    this.recentErrors = [];

    this.log(`start: ${live.length} destination(s) -> ${live.map(t => safeHost(t.url)).join(', ')}`);
    this.log(`encode: ${options.width}x${options.height} @ ${frameRate}fps, ${Math.round(videoBitrate / 1000)}kbps`);

    this.process.stderr.on('data', chunk => {
      const text = String(chunk);
      this.log(`ffmpeg: ${text.trim()}`);
      // ffmpeg reports connection problems on stderr; keep the last few lines
      // so a failure can be explained rather than just "it stopped".
      this.recentErrors.push(text.trim());
      if (this.recentErrors.length > 8) this.recentErrors.shift();
      if (/Connection refused|Server error|failed|Invalid|Unable to open/i.test(text)) {
        this.message = text.trim().split('\n').pop() || this.message;
        this.publish();
      }
    });

    this.process.on('error', error => {
      this.state = 'error';
      this.message = error.message;
      this.process = null;
      this.publish();
    });

    this.process.on('close', code => {
      this.log(`ffmpeg exited with code ${code} after ${this.bytesSent} bytes`);
      const wasLive = this.state === 'live' || this.state === 'starting';
      this.process = null;
      if (this.state === 'stopping') {
        this.state = 'idle';
        this.message = '';
      } else if (wasLive && (code !== 0 || this.bytesSent === 0)) {
        this.state = 'error';
        this.message = this.message
          || this.recentErrors.slice(-1)[0]
          || (this.bytesSent === 0
            ? 'The encoder received no video from the scene.'
            : `Streaming stopped unexpectedly (ffmpeg exit ${code}).`);
      } else {
        this.state = 'idle';
      }
      this.startedAt = 0;
      this.destinations = [];
      this.publish();
    });

    // A broken pipe is normal when ffmpeg exits first; it must not crash the app.
    this.process.stdin.on('error', () => {});

    this.state = 'live';
    this.publish();
    return { ok: true, destinations: this.destinations };
  }

  /** Feed one chunk of WebM from the renderer's recorder. */
  write(bytes) {
    if (!this.process || !this.process.stdin.writable) return false;
    const buffer = Buffer.from(bytes);
    this.bytesSent += buffer.length;
    try {
      this.process.stdin.write(buffer);
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    if (!this.process) {
      this.state = 'idle';
      this.publish();
      return { ok: true };
    }
    this.state = 'stopping';
    this.publish();
    try {
      // Closing stdin lets ffmpeg flush and finish cleanly.
      this.process.stdin.end();
    } catch { /* already closed */ }
    // If it has not exited shortly after, end it.
    const child = this.process;
    setTimeout(() => {
      if (child && !child.killed) {
        try { child.kill(); } catch { /* already gone */ }
      }
    }, 2500);
    return { ok: true };
  }
}

module.exports = { Streamer, ffmpegPath, safeHost };
