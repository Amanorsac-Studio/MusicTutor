/**
 * Live chat from a YouTube broadcast, shown beside the scene.
 *
 * Only YouTube is supported, and that is a limit of the platforms rather than a
 * choice: TikTok and Instagram publish no interface for reading a live chat, so
 * there is nothing to connect to. YouTube's is readable with an ordinary API
 * key as long as the broadcast is public, which avoids a sign-in flow.
 *
 * Reading is all this does. Replying would need the account's own credentials
 * and permission to post as the teacher, which is a different thing entirely.
 */

const API = 'https://www.googleapis.com/youtube/v3';

/** Where a YouTube API key is created. */
export const YOUTUBE_KEY_URL = 'https://console.cloud.google.com/apis/credentials';

export type ChatMessage = {
  id: string;
  author: string;
  text: string;
  /** Milliseconds since the epoch, for ordering and display. */
  published: number;
  /** Channel owner, moderator or sponsor, for highlighting. */
  badge?: 'owner' | 'moderator' | 'member';
};

/**
 * Pull a video id out of whatever the user pasted.
 *
 * They paste a watch URL, a share link, a studio link or the bare id, and all
 * of them should work rather than being rejected on a technicality.
 */
export function videoIdFrom(input: string): string {
  const text = input.trim();
  if (!text) return '';
  const bare = /^[A-Za-z0-9_-]{11}$/;
  if (bare.test(text)) return text;
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    const param = url.searchParams.get('v');
    if (param && bare.test(param)) return param;
    const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
    if (bare.test(last)) return last;
  } catch {
    /* not a URL; fall through */
  }
  return '';
}

/** True when a string looks like a Google API key, before spending a request. */
export const looksLikeApiKey = (key: string): boolean => /^[A-Za-z0-9_-]{30,}$/.test(key.trim());

export type ChatError = { message: string; fatal: boolean };

/**
 * Turn a Google API error into something a teacher can act on.
 *
 * The raw reasons are opaque, and the difference that matters is whether trying
 * again could help: a quota exhaustion is worth waiting out, a bad key is not.
 */
export function describeApiError(status: number, reason?: string): ChatError {
  if (status === 403 && reason === 'quotaExceeded') {
    return { message: 'The API key has used up today\'s quota. It resets at midnight Pacific time.', fatal: true };
  }
  if (status === 403 && reason === 'liveChatDisabled') {
    return { message: 'Live chat is switched off for this broadcast.', fatal: true };
  }
  if (status === 400 || status === 403) {
    return { message: 'The API key was rejected. Check it is a YouTube Data API v3 key with no site restrictions.', fatal: true };
  }
  if (status === 404) {
    return { message: 'No live chat found. Check the video id, and that the stream has started.', fatal: true };
  }
  if (status === 429 || status >= 500) {
    return { message: 'YouTube is not answering just now. Retrying.', fatal: false };
  }
  return { message: `Live chat request failed (${status}).`, fatal: status !== 0 };
}

/** Normalise one API item, dropping anything that is not a plain message. */
export function toMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as {
    id?: string;
    snippet?: { displayMessage?: string; publishedAt?: string; type?: string };
    authorDetails?: { displayName?: string; isChatOwner?: boolean; isChatModerator?: boolean; isChatSponsor?: boolean };
  };
  const text = item.snippet?.displayMessage;
  if (!item.id || !text) return null;
  const author = item.authorDetails ?? {};
  return {
    id: item.id,
    author: author.displayName ?? 'Viewer',
    text,
    published: Date.parse(item.snippet?.publishedAt ?? '') || Date.now(),
    badge: author.isChatOwner ? 'owner'
      : author.isChatModerator ? 'moderator'
        : author.isChatSponsor ? 'member'
          : undefined,
  };
}

/** Keep the newest messages only, so a long stream cannot grow without bound. */
export function appendMessages(
  existing: ChatMessage[], incoming: ChatMessage[], limit = 200,
): ChatMessage[] {
  if (!incoming.length) return existing;
  const seen = new Set(existing.map(message => message.id));
  const fresh = incoming.filter(message => !seen.has(message.id));
  if (!fresh.length) return existing;
  const combined = [...existing, ...fresh];
  return combined.length > limit ? combined.slice(combined.length - limit) : combined;
}

/**
 * How long to wait before asking again.
 *
 * YouTube returns its own interval and it must be respected, or the key's daily
 * quota is spent in an hour. Five seconds is the floor regardless.
 */
export const pollDelay = (suggested: number | undefined): number =>
  Math.max(5000, Math.min(30000, suggested ?? 8000));

type FetchLike = typeof fetch;

export type ChatSession = {
  liveChatId: string;
  nextPageToken?: string;
};

/** Find the chat attached to a live video. Returns an error message on failure. */
export async function findLiveChat(
  videoId: string, apiKey: string, doFetch: FetchLike = fetch,
): Promise<{ liveChatId?: string; error?: ChatError }> {
  const url = `${API}/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;
  let response: Response;
  try {
    response = await doFetch(url);
  } catch {
    return { error: { message: 'Could not reach YouTube. Check the internet connection.', fatal: false } };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { errors?: Array<{ reason?: string }> } } | null;
    return { error: describeApiError(response.status, body?.error?.errors?.[0]?.reason) };
  }
  const body = await response.json().catch(() => null) as {
    items?: Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }>;
  } | null;
  const liveChatId = body?.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!liveChatId) {
    return { error: { message: 'That video has no live chat running. Start the broadcast first.', fatal: true } };
  }
  return { liveChatId };
}

/** Fetch one page of chat. Returns the messages plus where to carry on from. */
export async function fetchChatPage(
  session: ChatSession, apiKey: string, doFetch: FetchLike = fetch,
): Promise<{ messages: ChatMessage[]; nextPageToken?: string; delay: number; error?: ChatError }> {
  const params = new URLSearchParams({
    liveChatId: session.liveChatId,
    part: 'snippet,authorDetails',
    maxResults: '200',
    key: apiKey,
  });
  if (session.nextPageToken) params.set('pageToken', session.nextPageToken);

  let response: Response;
  try {
    response = await doFetch(`${API}/liveChat/messages?${params.toString()}`);
  } catch {
    return { messages: [], delay: pollDelay(undefined), error: { message: 'Lost contact with YouTube. Retrying.', fatal: false } };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { errors?: Array<{ reason?: string }> } } | null;
    return { messages: [], delay: pollDelay(undefined), error: describeApiError(response.status, body?.error?.errors?.[0]?.reason) };
  }
  const body = await response.json().catch(() => null) as {
    items?: unknown[];
    nextPageToken?: string;
    pollingIntervalMillis?: number;
  } | null;
  const messages = (body?.items ?? [])
    .map(toMessage)
    .filter((message): message is ChatMessage => message !== null);
  return {
    messages,
    nextPageToken: body?.nextPageToken,
    delay: pollDelay(body?.pollingIntervalMillis),
  };
}

/** The API key is stored on this PC so it need only be pasted once. */
export const CHAT_STORAGE_KEY = 'pianotutor.youtubechat.v1';

export type ChatSettings = { apiKey: string; videoId: string };

export function loadChatSettings(): ChatSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) ?? 'null') as Partial<ChatSettings> | null;
    return {
      apiKey: typeof raw?.apiKey === 'string' ? raw.apiKey : '',
      videoId: typeof raw?.videoId === 'string' ? raw.videoId : '',
    };
  } catch {
    return { apiKey: '', videoId: '' };
  }
}

export function saveChatSettings(settings: ChatSettings): void {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(settings));
  } catch { /* private mode or quota */ }
}
