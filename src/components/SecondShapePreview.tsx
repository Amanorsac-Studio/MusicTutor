import { useEffect, useRef } from 'react';
import { secondaryCompositor } from '../lib/compositor';
import { getFormat } from '../lib/formats';

/**
 * A small live view of the other shape.
 *
 * When a lesson is being composed wide and tall at once, the tall one is not on
 * screen anywhere, and a picture nobody can see is a picture nobody has framed.
 * This mirrors the second compositor's own canvas, so what it shows is exactly
 * what is being recorded and streamed rather than a second guess at it.
 */
export function SecondShapePreview({ format }: { format: 'landscape' | 'portrait' | 'square' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const spec = getFormat(format);

  useEffect(() => {
    let frame = 0;
    const paint = () => {
      const canvas = ref.current;
      const ctx = canvas?.getContext('2d');
      const source = secondaryCompositor.surface();
      if (canvas && ctx && source.width && source.height) {
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      }
      frame = window.requestAnimationFrame(paint);
    };
    frame = window.requestAnimationFrame(paint);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // A fixed small backing size: this is a monitor, not an output, and copying
  // a 4K canvas into it every frame would cost more than it is worth.
  const height = 150;
  const width = Math.round(height * (spec.width / spec.height));

  return (
    <div className="second-preview">
      <canvas ref={ref} width={width} height={height} aria-label={`${spec.label} preview`} />
      <small>{spec.short} · also recording</small>
    </div>
  );
}
