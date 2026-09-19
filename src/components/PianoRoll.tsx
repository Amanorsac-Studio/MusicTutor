import { useEffect, useRef, useState } from 'react';
import { isBlackKey, noteName, type Accidental } from '../lib/chords';
import { chordLabel, type ChordSegment } from '../lib/chordTrack';
import { notesBetween, type RollNote } from '../lib/transcribe';
import type { BeatGrid } from '../lib/beats';

/** Seconds of music on screen: a little behind the playhead, more ahead of it. */
const BEHIND = 2;
const AHEAD = 6;

/**
 * The song as a scrolling piano roll.
 *
 * Time runs left to right past a fixed playhead, the way every learning video
 * does it, so the eye stays in one place and the music comes to it. Pitch runs
 * bottom to top against a strip of piano keys, so a bar on the roll lines up
 * with the key that plays it. The chords ride along the top.
 *
 * The position is read straight from the player on every animation frame and
 * never passes through React. At sixty frames a second, setting state per frame
 * would re-render the whole page to move some rectangles.
 */
export function PianoRoll({
  notes, chords, grid, range, accidental, transpose, getPosition, loop, onSeek,
}: {
  notes: RollNote[];
  chords: ChordSegment[];
  grid?: BeatGrid;
  range: { low: number; high: number };
  accidental: Accidental;
  /** Semitones the playback is shifted by, so the roll shows what is heard. */
  transpose: number;
  getPosition: () => number;
  loop: { start: number; end: number } | null;
  onSeek: (time: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !size.width || !size.height) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);

    let frame = 0;
    const paint = () => {
      frame = window.requestAnimationFrame(paint);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const { width, height } = size;
      const now = getPosition();

      const gutter = 46;
      const chordLane = 34;
      const rollTop = chordLane;
      const rollHeight = height - rollTop;
      const low = range.low;
      const high = range.high;
      const rows = high - low + 1;
      const rowHeight = rollHeight / rows;
      const perSecond = (width - gutter) / (BEHIND + AHEAD);
      const playheadX = gutter + BEHIND * perSecond;
      const xOf = (time: number) => playheadX + (time - now) * perSecond;
      const yOf = (midi: number) => rollTop + (high - midi) * rowHeight;

      ctx.fillStyle = '#07111b';
      ctx.fillRect(0, 0, width, height);

      // Rows, shaded where the black keys are, so pitch can be read at a glance.
      for (let midi = low; midi <= high; midi += 1) {
        if (isBlackKey(midi)) {
          ctx.fillStyle = 'rgba(255,255,255,0.028)';
          ctx.fillRect(gutter, yOf(midi), width - gutter, rowHeight);
        }
        if (midi % 12 === 0) {
          ctx.fillStyle = 'rgba(120,160,195,0.16)';
          ctx.fillRect(gutter, yOf(midi) + rowHeight - 1, width - gutter, 1);
        }
      }

      // The loop region.
      if (loop) {
        const from = Math.max(gutter, xOf(loop.start));
        const to = Math.min(width, xOf(loop.end));
        if (to > from) {
          ctx.fillStyle = 'rgba(255,166,41,0.07)';
          ctx.fillRect(from, rollTop, to - from, rollHeight);
        }
      }

      // Beats, with bar lines heavier.
      if (grid?.beats.length) {
        grid.beats.forEach((beat, index) => {
          const x = xOf(beat);
          if (x < gutter || x > width) return;
          const downbeat = (index - grid.firstDownbeat) % grid.beatsPerBar === 0;
          ctx.fillStyle = downbeat ? 'rgba(120,160,195,0.3)' : 'rgba(120,160,195,0.1)';
          ctx.fillRect(x, rollTop, 1, rollHeight);
        });
      }

      // Notes. The tune is drawn in the accent colour so it can be followed.
      const shift = transpose;
      notesBetween(notes, now - BEHIND - 1, now + AHEAD + 1).forEach(note => {
        const midi = note.midi + shift;
        if (midi < low || midi > high) return;
        const x = Math.max(gutter, xOf(note.start));
        const end = Math.min(width, xOf(note.end));
        if (end <= gutter || x >= width) return;
        const sounding = note.start <= now && note.end > now;
        const alpha = 0.45 + note.velocity * 0.55;
        ctx.globalAlpha = sounding ? 1 : alpha;
        ctx.fillStyle = note.melody
          ? (sounding ? '#ffd089' : '#ffa629')
          : (sounding ? '#9bd4ff' : '#2f8fd6');
        const h = Math.max(2, rowHeight - 1);
        ctx.fillRect(x, yOf(midi) + (rowHeight - h) / 2, Math.max(2, end - x - 1), h);
        ctx.globalAlpha = 1;
      });

      // The keys down the left, lighting up as notes pass the playhead.
      const soundingNow = new Set<number>();
      notesBetween(notes, now, now).forEach(note => {
        if (note.start <= now && note.end > now) soundingNow.add(note.midi + shift);
      });
      for (let midi = low; midi <= high; midi += 1) {
        const lit = soundingNow.has(midi);
        ctx.fillStyle = lit ? '#ffa629' : isBlackKey(midi) ? '#141c25' : '#d9dee3';
        ctx.fillRect(0, yOf(midi), gutter - 2, Math.max(1, rowHeight - 0.5));
        if (midi % 12 === 0 && rowHeight >= 7) {
          ctx.fillStyle = lit ? '#10151c' : '#4a5866';
          ctx.font = `600 ${Math.min(10, rowHeight)}px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${noteName(midi, accidental)}${Math.floor(midi / 12) - 1}`, gutter - 6, yOf(midi) + rowHeight / 2);
        }
      }

      // The chord lane.
      ctx.fillStyle = '#0b1825';
      ctx.fillRect(0, 0, width, chordLane);
      chords.forEach(segment => {
        const from = xOf(segment.start);
        const to = xOf(segment.end);
        if (to < gutter || from > width || segment.root < 0) return;
        const x = Math.max(gutter, from);
        const current = segment.start <= now && segment.end > now;
        ctx.fillStyle = current ? 'rgba(255,166,41,0.2)' : 'rgba(47,143,214,0.12)';
        ctx.fillRect(x, 3, Math.min(width, to) - x - 2, chordLane - 6);
        ctx.fillStyle = current ? '#ffc773' : '#a9c4dc';
        ctx.font = '700 13px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        if (Math.min(width, to) - x > 26) {
          ctx.fillText(chordLabel(segment, accidental, shift), x + 6, chordLane / 2);
        }
      });

      // The playhead, over everything.
      ctx.fillStyle = '#ffa629';
      ctx.fillRect(playheadX - 1, 0, 2, height);
    };
    frame = window.requestAnimationFrame(paint);
    return () => window.cancelAnimationFrame(frame);
  }, [notes, chords, grid, range.low, range.high, accidental, transpose, getPosition, loop, size]);

  return (
    <div className="piano-roll" ref={holder}>
      <canvas
        ref={ref}
        style={{ width: '100%', height: '100%' }}
        aria-label="Piano roll. Click to move the playhead."
        onClick={event => {
          const box = event.currentTarget.getBoundingClientRect();
          const gutter = 46;
          const perSecond = (box.width - gutter) / (BEHIND + AHEAD);
          const playheadX = gutter + BEHIND * perSecond;
          onSeek(Math.max(0, getPosition() + (event.clientX - box.left - playheadX) / perSecond));
        }}
      />
    </div>
  );
}
