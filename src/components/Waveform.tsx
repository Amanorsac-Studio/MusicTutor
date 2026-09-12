import { useCallback, useEffect, useRef, useState } from 'react';
import type { Peak } from '../lib/timeStretch';
import type { BeatGrid } from '../lib/beats';

/**
 * The track, drawn.
 *
 * A slider tells you a number; a waveform tells you where the chorus is. For
 * practising, being able to see the shape of a piece and drag a loop straight
 * onto the bars you want is the difference between a player and a practice
 * tool.
 *
 * Dragging across the waveform sets the loop. Clicking moves the playhead.
 * Both snap to the tracked beats, so a loop lands on the music rather than
 * a fraction of a beat before it.
 */
export function Waveform({
  peaks, duration, position, loop, grid, snap, onSeek, onLoop, accent = '#ffa629',
}: {
  peaks: Peak[];
  duration: number;
  position: number;
  loop: { start: number; end: number } | null;
  grid?: BeatGrid;
  /** Snap a time to the nearest beat, or bar when asked. */
  snap: (time: number, toBar: boolean) => number;
  onSeek: (time: number) => void;
  onLoop: (range: { start: number; end: number } | null) => void;
  accent?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 84 });
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  // Follow the panel's width. jsdom has no ResizeObserver, so a plain
  // measurement stands in where the observer is missing.
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const measure = () => setSize({
      width: element.clientWidth,
      height: Math.max(60, element.clientHeight),
    });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const timeAt = useCallback((clientX: number): number => {
    const element = ref.current;
    if (!element || duration <= 0) return 0;
    const box = element.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - box.left) / Math.max(1, box.width)));
    return fraction * duration;
  }, [duration]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !size.width) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const { width, height } = size;
    const middle = height / 2;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#07131d';
    ctx.fillRect(0, 0, width, height);

    // The loop region, behind everything, so the waveform stays readable.
    const region = drag
      ? { start: Math.min(drag.from, drag.to), end: Math.max(drag.from, drag.to) }
      : loop;
    if (region && duration > 0) {
      const from = (region.start / duration) * width;
      const to = (region.end / duration) * width;
      ctx.fillStyle = 'rgba(255,166,41,0.13)';
      ctx.fillRect(from, 0, Math.max(1, to - from), height);
      ctx.strokeStyle = 'rgba(255,166,41,0.55)';
      ctx.lineWidth = 1;
      [from, to].forEach(x => {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      });
    }

    // Bar lines, so the eye can count. Beats alone would be a picket fence.
    if (grid?.beats.length && duration > 0) {
      const spacing = width / Math.max(1, grid.beats.length);
      ctx.strokeStyle = 'rgba(120,160,195,0.22)';
      ctx.lineWidth = 1;
      grid.beats.forEach((beat, index) => {
        const downbeat = (index - grid.firstDownbeat) % grid.beatsPerBar === 0;
        // Beats are only worth drawing when they are not on top of each other.
        if (!downbeat && spacing < 6) return;
        const x = (beat / duration) * width;
        ctx.globalAlpha = downbeat ? 1 : 0.45;
        ctx.beginPath();
        ctx.moveTo(x, downbeat ? 0 : height * 0.34);
        ctx.lineTo(x, downbeat ? height : height * 0.66);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    // The waveform itself, one vertical stroke per pixel column.
    if (peaks.length) {
      ctx.fillStyle = '#4d7f9e';
      for (let x = 0; x < width; x += 1) {
        const peak = peaks[Math.min(peaks.length - 1, Math.floor((x / width) * peaks.length))];
        const top = middle - peak.max * middle * 0.92;
        const bottom = middle - peak.min * middle * 0.92;
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
    }

    if (duration > 0) {
      const x = (Math.max(0, Math.min(duration, position)) / duration) * width;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }, [peaks, duration, position, loop, grid, size, drag, accent]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (duration <= 0) return;
    // Capture keeps a drag alive when the pointer leaves the canvas, but it is
    // not available for every pointer and must not take the drag down with it.
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
    const at = snap(timeAt(event.clientX), event.shiftKey);
    setDrag({ from: at, to: at });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    setDrag({ ...drag, to: snap(timeAt(event.clientX), event.shiftKey) });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    const from = Math.min(drag.from, drag.to);
    const to = Math.max(drag.from, drag.to);
    setDrag(null);
    // A drag of less than a tenth of a second was a click, not a selection.
    if (to - from < 0.1) onSeek(from);
    else onLoop({ start: from, end: to });
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
  };

  return (
    <div className="waveform" ref={holder}>
      <canvas
        ref={ref}
        style={{ width: '100%', height: `${size.height}px` }}
        aria-label="Track waveform. Click to move the playhead, drag to set a loop."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  );
}
