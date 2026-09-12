import { describe, expect, it, vi } from 'vitest';
import {
  appendMessages, describeApiError, fetchChatPage, findLiveChat, looksLikeApiKey,
  pollDelay, toMessage, videoIdFrom,
} from './liveChat';

const jsonResponse = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('videoIdFrom', () => {
  it('accepts a bare id', () => {
    expect(videoIdFrom('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('reads a watch URL', () => {
    expect(videoIdFrom('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30')).toBe('dQw4w9WgXcQ');
  });

  it('reads a share link', () => {
    expect(videoIdFrom('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('reads a live URL', () => {
    expect(videoIdFrom('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('tolerates surrounding whitespace', () => {
    expect(videoIdFrom('  dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ');
  });

  it('returns nothing for what is not a video', () => {
    expect(videoIdFrom('')).toBe('');
    expect(videoIdFrom('hello there')).toBe('');
    expect(videoIdFrom('https://example.com/')).toBe('');
  });
});

describe('looksLikeApiKey', () => {
  it('accepts a key-shaped string', () => {
    expect(looksLikeApiKey('AIzaSyB1234567890abcdefghijklmnopqrstu')).toBe(true);
  });

  it('rejects something obviously too short', () => {
    expect(looksLikeApiKey('abc')).toBe(false);
    expect(looksLikeApiKey('')).toBe(false);
  });
});

describe('describeApiError', () => {
  it('marks a bad key as not worth retrying', () => {
    expect(describeApiError(403, 'badRequest').fatal).toBe(true);
  });

  it('marks a server wobble as retryable', () => {
    expect(describeApiError(503).fatal).toBe(false);
    expect(describeApiError(429).fatal).toBe(false);
  });

  it('explains an exhausted quota', () => {
    expect(describeApiError(403, 'quotaExceeded').message).toMatch(/quota/i);
  });

  it('explains chat being switched off', () => {
    expect(describeApiError(403, 'liveChatDisabled').message).toMatch(/switched off/i);
  });
});

describe('toMessage', () => {
  it('reads a plain message', () => {
    const message = toMessage({
      id: 'm1',
      snippet: { displayMessage: 'Great lesson', publishedAt: '2026-01-01T10:00:00Z' },
      authorDetails: { displayName: 'Ama' },
    });
    expect(message?.author).toBe('Ama');
    expect(message?.text).toBe('Great lesson');
    expect(message?.badge).toBeUndefined();
  });

  it('marks the owner and moderators', () => {
    expect(toMessage({ id: 'a', snippet: { displayMessage: 'x' }, authorDetails: { isChatOwner: true } })?.badge)
      .toBe('owner');
    expect(toMessage({ id: 'b', snippet: { displayMessage: 'x' }, authorDetails: { isChatModerator: true } })?.badge)
      .toBe('moderator');
  });

  it('drops events that carry no text, such as a member joining', () => {
    expect(toMessage({ id: 'c', snippet: { type: 'newSponsorEvent' } })).toBeNull();
    expect(toMessage(null)).toBeNull();
    expect(toMessage({ snippet: { displayMessage: 'no id' } })).toBeNull();
  });
});

describe('appendMessages', () => {
  const make = (id: string) => ({ id, author: 'A', text: id, published: 1 });

  it('adds new messages in order', () => {
    expect(appendMessages([make('1')], [make('2')]).map(m => m.id)).toEqual(['1', '2']);
  });

  it('ignores messages already shown', () => {
    expect(appendMessages([make('1')], [make('1')]).map(m => m.id)).toEqual(['1']);
  });

  it('keeps the same array when nothing is new, so the view does not redraw', () => {
    const existing = [make('1')];
    expect(appendMessages(existing, [make('1')])).toBe(existing);
    expect(appendMessages(existing, [])).toBe(existing);
  });

  it('drops the oldest once the limit is passed', () => {
    const existing = Array.from({ length: 5 }, (_, i) => make(`old${i}`));
    const result = appendMessages(existing, [make('new')], 3);
    expect(result).toHaveLength(3);
    expect(result[result.length - 1].id).toBe('new');
  });
});

describe('pollDelay', () => {
  it('never polls faster than five seconds, whatever is suggested', () => {
    expect(pollDelay(100)).toBe(5000);
    expect(pollDelay(0)).toBe(5000);
  });

  it('respects a longer interval from YouTube', () => {
    expect(pollDelay(12000)).toBe(12000);
  });

  it('caps a very long interval so the chat does not appear stuck', () => {
    expect(pollDelay(600000)).toBe(30000);
  });

  it('has a sensible default when none is given', () => {
    expect(pollDelay(undefined)).toBe(8000);
  });
});

describe('findLiveChat', () => {
  it('returns the chat id of a running broadcast', async () => {
    const doFetch = vi.fn(async () => jsonResponse({
      items: [{ liveStreamingDetails: { activeLiveChatId: 'chat123' } }],
    }));
    const result = await findLiveChat('vid', 'key', doFetch as unknown as typeof fetch);
    expect(result.liveChatId).toBe('chat123');
  });

  it('explains a video that is not live', async () => {
    const doFetch = vi.fn(async () => jsonResponse({ items: [{}] }));
    const result = await findLiveChat('vid', 'key', doFetch as unknown as typeof fetch);
    expect(result.liveChatId).toBeUndefined();
    expect(result.error?.fatal).toBe(true);
  });

  it('passes a rejected key through as fatal', async () => {
    const doFetch = vi.fn(async () => jsonResponse({ error: { errors: [{ reason: 'badRequest' }] } }, 403));
    const result = await findLiveChat('vid', 'bad', doFetch as unknown as typeof fetch);
    expect(result.error?.fatal).toBe(true);
  });

  it('treats a network failure as worth retrying', async () => {
    const doFetch = vi.fn(async () => { throw new Error('offline'); });
    const result = await findLiveChat('vid', 'key', doFetch as unknown as typeof fetch);
    expect(result.error?.fatal).toBe(false);
  });

  it('never puts the key anywhere but the request', async () => {
    const doFetch = vi.fn(async () => jsonResponse({ items: [{ liveStreamingDetails: { activeLiveChatId: 'c' } }] }));
    const result = await findLiveChat('vid', 'secret-key', doFetch as unknown as typeof fetch);
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });
});

describe('fetchChatPage', () => {
  it('reads messages and the continuation token', async () => {
    const doFetch = vi.fn(async () => jsonResponse({
      items: [{ id: 'm1', snippet: { displayMessage: 'hi' }, authorDetails: { displayName: 'Ama' } }],
      nextPageToken: 'page2',
      pollingIntervalMillis: 9000,
    }));
    const result = await fetchChatPage({ liveChatId: 'c' }, 'key', doFetch as unknown as typeof fetch);
    expect(result.messages.map(m => m.text)).toEqual(['hi']);
    expect(result.nextPageToken).toBe('page2');
    expect(result.delay).toBe(9000);
  });

  it('sends the page token on a follow-up request', async () => {
    const doFetch = vi.fn(async () => jsonResponse({ items: [] }));
    await fetchChatPage({ liveChatId: 'c', nextPageToken: 'page2' }, 'key', doFetch as unknown as typeof fetch);
    expect(String((doFetch.mock.calls as unknown as string[][])[0][0])).toContain('pageToken=page2');
  });

  it('returns an empty page rather than throwing when the request fails', async () => {
    const doFetch = vi.fn(async () => { throw new Error('offline'); });
    const result = await fetchChatPage({ liveChatId: 'c' }, 'key', doFetch as unknown as typeof fetch);
    expect(result.messages).toEqual([]);
    expect(result.error?.fatal).toBe(false);
  });
});
