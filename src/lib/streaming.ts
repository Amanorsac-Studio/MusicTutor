/**
 * Live streaming destinations.
 *
 * Chromium cannot speak RTMP, so the desktop shell runs a bundled ffmpeg: the
 * composed canvas and the programme mix are recorded to WebM in the renderer,
 * piped to ffmpeg, transcoded to H.264/AAC and pushed to each destination. One
 * encode feeds every destination through ffmpeg's tee muxer, so streaming to
 * three places costs roughly what one costs.
 */

export type PlatformId = 'youtube' | 'tiktok' | 'instagram' | 'custom';

export type Platform = {
  id: PlatformId;
  name: string;
  /** Default ingest URL; the stream key is appended as the path. */
  server: string;
  /** Where the user finds their stream key. */
  keyHint: string;
  /** Page where the key is actually issued, opened in the browser. */
  keyUrl?: string;
  /** Formats this platform expects. Advisory, not enforced. */
  prefers: 'landscape' | 'portrait' | 'either';
  /**
   * Anything the user should know before trying. Empty when the platform works
   * normally with a stream key.
   */
  caveat?: string;
};

export const PLATFORMS: Record<PlatformId, Platform> = {
  youtube: {
    id: 'youtube',
    name: 'YouTube Live',
    server: 'rtmp://a.rtmp.youtube.com/live2',
    keyHint: 'YouTube Studio → Go Live → Stream key',
    keyUrl: 'https://studio.youtube.com/channel/UC/livestreaming',
    prefers: 'landscape',
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok Live',
    server: 'rtmp://push.tiktokcdn.com/live',
    keyHint: 'TikTok LIVE Studio → Stream key',
    keyUrl: 'https://livecenter.tiktok.com/live_monitor',
    prefers: 'portrait',
    caveat: 'TikTok only issues stream keys to accounts with LIVE access, which '
      + 'is granted at a follower threshold. Without it there is no key to enter.',
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram Live',
    server: 'rtmps://live-upload.instagram.com:443/rtmp',
    keyHint: 'Instagram no longer issues stream keys to most accounts',
    prefers: 'portrait',
    caveat: 'Instagram withdrew third-party RTMP streaming for ordinary accounts. '
      + 'This will almost certainly fail to connect. It is here for the few '
      + 'accounts that retain access, and for when a key is obtained another way.',
  },
  custom: {
    id: 'custom',
    name: 'Custom RTMP',
    server: '',
    keyHint: 'Any RTMP or RTMPS server — Twitch, Facebook, an own server',
    prefers: 'either',
  },
};

export const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];

export type Destination = {
  id: string;
  platform: PlatformId;
  name: string;
  /** Ingest server; defaults to the platform's when left blank. */
  server: string;
  /** Stream key. A secret: never log it, never put it in a URL for display. */
  key: string;
  enabled: boolean;
  /**
   * Which composed shape this destination receives.
   *
   * A wide picture on a vertical platform is letterboxed into a thin band, so
   * when both shapes are being composed each destination should take the one
   * its platform expects.
   */
  output: 'primary' | 'secondary';
};

export type StreamStatus = {
  state: 'idle' | 'starting' | 'live' | 'stopping' | 'error';
  /** Destinations currently being pushed to. */
  destinations: string[];
  message?: string;
  /** Seconds since the stream went live. */
  uptime: number;
  /** Bytes handed to the encoder. */
  bytesSent: number;
};

export const EMPTY_STATUS: StreamStatus = {
  state: 'idle', destinations: [], uptime: 0, bytesSent: 0,
};

let counter = 0;
export const createDestination = (platform: PlatformId = 'youtube'): Destination => ({
  id: `dest_${Date.now().toString(36)}_${(counter++).toString(36)}`,
  platform,
  name: PLATFORMS[platform].name,
  server: PLATFORMS[platform].server,
  key: '',
  enabled: true,
  output: 'primary',
});

/**
 * Join a server and key into a full ingest URL.
 *
 * Servers are written both ways in the wild — with and without a trailing
 * slash — and a key pasted from a web page often carries whitespace.
 */
export function ingestUrl(destination: Destination): string {
  const server = (destination.server || PLATFORMS[destination.platform].server).trim().replace(/\/+$/, '');
  const key = destination.key.trim();
  if (!server) return '';
  return key ? `${server}/${key}` : server;
}

/** Hide the key when showing a destination on screen or in a log. */
export function maskedUrl(destination: Destination): string {
  const server = (destination.server || PLATFORMS[destination.platform].server).trim().replace(/\/+$/, '');
  const key = destination.key.trim();
  if (!key) return server || '(no server)';
  const tail = key.length > 4 ? key.slice(-4) : '';
  return `${server}/••••${tail}`;
}

export type DestinationProblem = { id: string; message: string };

/** Reasons a destination cannot be streamed to, for showing before going live. */
export function validateDestination(destination: Destination): DestinationProblem | null {
  const server = (destination.server || PLATFORMS[destination.platform].server).trim();
  if (!server) return { id: destination.id, message: 'No ingest server set.' };
  if (!/^rtmps?:\/\//i.test(server)) {
    return { id: destination.id, message: 'The server must start with rtmp:// or rtmps://.' };
  }
  if (!destination.key.trim()) return { id: destination.id, message: 'No stream key entered.' };
  return null;
}

export function validateAll(destinations: Destination[]): DestinationProblem[] {
  return destinations
    .filter(destination => destination.enabled)
    .map(validateDestination)
    .filter((problem): problem is DestinationProblem => problem !== null);
}

/**
 * Advise when a destination's shape does not match what the platform expects —
 * a landscape canvas pushed to TikTok will be letterboxed into a thin band.
 */
export function formatWarning(destination: Destination, format: string): string | null {
  const prefers = PLATFORMS[destination.platform].prefers;
  if (prefers === 'either') return null;
  if (prefers === 'portrait' && format !== 'portrait') {
    return `${PLATFORMS[destination.platform].name} expects a vertical picture; your canvas is ${format}.`;
  }
  if (prefers === 'landscape' && format === 'portrait') {
    return `${PLATFORMS[destination.platform].name} expects a horizontal picture; your canvas is portrait.`;
  }
  return null;
}

/** Keys are secrets, so they are stored apart from the scene data. */
export const STREAM_STORAGE_KEY = 'pianotutor.destinations.v1';

export function normalizeDestinations(raw: unknown): Destination[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Partial<Destination>;
    const platform = (PLATFORM_IDS as string[]).includes(String(item.platform))
      ? (item.platform as PlatformId)
      : 'custom';
    return [{
      id: typeof item.id === 'string' ? item.id : createDestination(platform).id,
      platform,
      name: typeof item.name === 'string' ? item.name : PLATFORMS[platform].name,
      server: typeof item.server === 'string' ? item.server : PLATFORMS[platform].server,
      key: typeof item.key === 'string' ? item.key : '',
      enabled: item.enabled !== false,
      output: item.output === 'secondary' ? 'secondary' : 'primary',
    }];
  });
}

/**
 * Destinations kept between sessions, so a key is pasted once and reused.
 *
 * Stored under its own key rather than with the settings, which are exported
 * with a project: a stream key must not travel in a shared project file.
 */
export function loadDestinations(): Destination[] {
  try {
    const stored = localStorage.getItem(STREAM_STORAGE_KEY);
    return normalizeDestinations(stored ? JSON.parse(stored) : null);
  } catch {
    return [];
  }
}

export function saveDestinations(destinations: Destination[]): void {
  try {
    localStorage.setItem(STREAM_STORAGE_KEY, JSON.stringify(destinations));
  } catch { /* private mode or quota */ }
}
