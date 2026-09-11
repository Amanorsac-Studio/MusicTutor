/**
 * Output formats and recording resolutions.
 *
 * A format is the shape of the programme: landscape for YouTube, portrait for
 * TikTok and Reels, square for feed posts. Each format has its own *layout
 * space* — the coordinate system scenes are arranged in — which is independent
 * of the resolution actually recorded. A 4K landscape recording uses the same
 * 1920x1080 layout space, rendered at twice the scale.
 */

export type OutputFormatId = 'landscape' | 'portrait' | 'square';

export type OutputFormat = {
  id: OutputFormatId;
  label: string;
  short: string;
  aspect: string;
  /** The coordinate space scenes are laid out in. */
  width: number;
  height: number;
};

export const OUTPUT_FORMATS: Record<OutputFormatId, OutputFormat> = {
  landscape: {
    id: 'landscape', label: 'Landscape — YouTube', short: 'Landscape', aspect: '16:9',
    width: 1920, height: 1080,
  },
  portrait: {
    id: 'portrait', label: 'Portrait — TikTok, Reels, Shorts', short: 'Portrait', aspect: '9:16',
    width: 1080, height: 1920,
  },
  square: {
    id: 'square', label: 'Square — feed posts', short: 'Square', aspect: '1:1',
    width: 1080, height: 1080,
  },
};

export const FORMAT_IDS = Object.keys(OUTPUT_FORMATS) as OutputFormatId[];

export const DEFAULT_FORMAT: OutputFormatId = 'landscape';

export function getFormat(id: string | undefined): OutputFormat {
  return OUTPUT_FORMATS[(id as OutputFormatId)] ?? OUTPUT_FORMATS[DEFAULT_FORMAT];
}

export type CanvasSize = { width: number; height: number };

/* ------------------------------------------------------------------ *
 * Recording resolution
 * ------------------------------------------------------------------ */

export type ResolutionId = 'sd' | 'hd' | 'full' | 'quad' | 'uhd';

export type Resolution = {
  id: ResolutionId;
  label: string;
  /** Multiplier applied to the format's layout space. */
  scale: number;
  /** Rough vertical pixel count, for display. */
  note: string;
};

/**
 * Resolutions are expressed as a scale of the layout space rather than fixed
 * pixel sizes, so the same choice means something sensible in portrait as in
 * landscape: "Full HD" is 1920x1080 landscape and 1080x1920 portrait.
 */
export const RESOLUTIONS: Record<ResolutionId, Resolution> = {
  sd: { id: 'sd', label: 'SD', scale: 0.5, note: 'Half size — small files' },
  hd: { id: 'hd', label: 'HD 720p', scale: 0.6667, note: 'Good for quick drafts' },
  full: { id: 'full', label: 'Full HD 1080p', scale: 1, note: 'Standard for most uploads' },
  quad: { id: 'quad', label: 'QHD 1440p', scale: 1.3333, note: 'Sharper text and keys' },
  uhd: { id: 'uhd', label: '4K UHD', scale: 2, note: 'Highest quality, large files' },
};

export const RESOLUTION_IDS = Object.keys(RESOLUTIONS) as ResolutionId[];

export function getResolution(id: string | undefined): Resolution {
  return RESOLUTIONS[(id as ResolutionId)] ?? RESOLUTIONS.full;
}

/** Even dimensions — most encoders reject odd width or height. */
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** The pixel size a format records at, for a given resolution. */
export function renderSize(format: OutputFormat, resolution: Resolution): CanvasSize {
  return {
    width: even(format.width * resolution.scale),
    height: even(format.height * resolution.scale),
  };
}

/* ------------------------------------------------------------------ *
 * Bitrate
 * ------------------------------------------------------------------ */

export type QualityLevel = 'efficient' | 'balanced' | 'high' | 'master';

export const QUALITY_LEVELS: Record<QualityLevel, { label: string; bitsPerPixel: number; note: string }> = {
  efficient: { label: 'Efficient', bitsPerPixel: 0.06, note: 'Smaller files, softer detail' },
  balanced: { label: 'Balanced', bitsPerPixel: 0.11, note: 'Good upload quality' },
  high: { label: 'High', bitsPerPixel: 0.18, note: 'Crisp keys and text' },
  master: { label: 'Master', bitsPerPixel: 0.30, note: 'Near-lossless, very large files' },
};

/**
 * Pick a video bitrate from the picture size and frame rate rather than a fixed
 * table, so quality holds up whatever format and resolution are chosen.
 * Bits-per-pixel-per-frame is the usual way encoders are budgeted.
 */
export function bitrateFor(size: CanvasSize, frameRate: number, quality: QualityLevel): number {
  const { bitsPerPixel } = QUALITY_LEVELS[quality] ?? QUALITY_LEVELS.balanced;
  const raw = size.width * size.height * frameRate * bitsPerPixel;
  // Keep within what browser encoders and upload pipelines cope with.
  return Math.round(Math.min(120_000_000, Math.max(1_500_000, raw)));
}

export const FRAME_RATES = [24, 25, 30, 50, 60] as const;
export type FrameRate = (typeof FRAME_RATES)[number];
