/**
 * Scene compositor.
 *
 * Continuously paints the active scene onto an offscreen 1920x1080 canvas and
 * exposes it as a MediaStream. The recorder captures this stream, so a take
 * contains exactly the composition — never the side panels, the toolbar, or
 * anything else on screen.
 */

import { type Source } from './scene';
import { LANDSCAPE_CANVAS } from './scene';
import type { CanvasSize } from './formats';
import { drawScene, type RenderContext } from './drawScene';

export type SceneProvider = () => {
  sources: Source[];
  context: RenderContext;
  /** The layout space the sources are positioned in. */
  canvas: CanvasSize;
  background?: string;
};

export class SceneCompositor {
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D | null;
  private timer = 0;
  private provider?: SceneProvider;
  private fps = 30;
  /** Pixel size of the output. Distinct from the layout space it is drawn from. */
  private output: CanvasSize = { ...LANDSCAPE_CANVAS };
  private images = new Map<string, HTMLImageElement>();
  private pendingImages = new Set<string>();

  setProvider(provider: SceneProvider): void {
    this.provider = provider;
  }

  /** The canvas being painted, created on first use. */
  surface(): HTMLCanvasElement {
    if (!this.canvas) {
      const canvas = document.createElement('canvas');
      canvas.width = this.output.width;
      canvas.height = this.output.height;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
    }
    return this.canvas;
  }

  /**
   * Set the pixel size actually recorded. This is what makes a 4K choice mean
   * 4K: previously the surface was fixed at 1920x1080 and only the bitrate
   * changed, so "4K" produced an upscaled 1080p file.
   */
  setOutputSize(size: CanvasSize): void {
    const width = Math.max(2, Math.round(size.width));
    const height = Math.max(2, Math.round(size.height));
    if (this.output.width === width && this.output.height === height && this.canvas) return;
    this.output = { width, height };
    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  get outputSize(): CanvasSize {
    return { ...this.output };
  }

  get running(): boolean {
    return this.timer !== 0;
  }

  /**
   * Begin painting. Uses a timer rather than animation frames so the output
   * keeps running when the window is minimised, which matters mid-recording.
   */
  start(fps = 30): void {
    this.fps = fps;
    this.surface();
    if (this.timer) window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.renderFrame(), Math.max(1, Math.round(1000 / fps)));
    this.renderFrame();
  }

  stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  /** Paint one frame immediately. */
  renderFrame(): void {
    const ctx = this.ctx;
    const provider = this.provider;
    if (!ctx || !provider) return;
    const { sources, context, canvas, background } = provider();
    this.ensureImages(sources, context);

    // Sources are positioned in layout space; scale the context so the same
    // coordinates fill whatever resolution is being recorded.
    ctx.save();
    ctx.setTransform(
      this.output.width / canvas.width, 0, 0,
      this.output.height / canvas.height, 0, 0,
    );
    drawScene(ctx, sources, context, canvas, background);
    ctx.restore();
  }

  /**
   * Load any image sources that are not cached yet. Decoding happens off the
   * draw path; a source simply renders empty until its picture is ready.
   */
  private ensureImages(sources: Source[], context: RenderContext): void {
    sources.forEach(source => {
      if (source.kind !== 'image') return;
      const src = source.props.src;
      if (!src) return;
      const cacheKey = `${source.id}:${src}`;
      const cached = this.images.get(cacheKey);
      if (cached) {
        if (cached.complete && cached.naturalWidth > 0) context.images.set(source.id, cached);
        return;
      }
      if (this.pendingImages.has(cacheKey)) return;
      this.pendingImages.add(cacheKey);
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => { this.images.set(cacheKey, image); this.pendingImages.delete(cacheKey); };
      image.onerror = () => { this.pendingImages.delete(cacheKey); };
      image.src = src;
    });
  }

  /** MediaStream carrying the composed video, for MediaRecorder. */
  captureStream(fps = this.fps): MediaStream {
    const canvas = this.surface();
    return canvas.captureStream(fps);
  }

  dispose(): void {
    this.stop();
    this.images.clear();
    this.pendingImages.clear();
    this.canvas = undefined;
    this.ctx = undefined;
  }
}

export const sceneCompositor = new SceneCompositor();

/**
 * A second compositor, painting the same scene in the other shape.
 *
 * A lesson filmed once is wanted twice: wide for YouTube and tall for a phone.
 * Cropping one from the other throws away the framing, so both are composed
 * from the same scene using that format's own layout, and either can be
 * recorded or streamed independently.
 *
 * It only runs when a second format is chosen, so nothing is paid for it
 * otherwise.
 */
export const secondaryCompositor = new SceneCompositor();

// Dev-only handle for diagnostics in the browser console. Stripped from production builds.
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__pianoTutorCompositor = sceneCompositor;
}
