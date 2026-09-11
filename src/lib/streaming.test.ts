import { describe, expect, it } from 'vitest';
import {
  PLATFORMS, createDestination, formatWarning, ingestUrl, maskedUrl,
  normalizeDestinations, validateAll, validateDestination, type Destination,
} from './streaming';

const dest = (over: Partial<Destination> = {}): Destination => ({ ...createDestination('youtube'), ...over });

describe('platforms', () => {
  it('covers the three the app advertises, plus custom', () => {
    expect(Object.keys(PLATFORMS)).toEqual(['youtube', 'tiktok', 'instagram', 'custom']);
  });

  it('uses rtmp or rtmps ingest servers', () => {
    Object.values(PLATFORMS).forEach(platform => {
      if (!platform.server) return;
      expect(platform.server).toMatch(/^rtmps?:\/\//);
    });
  });

  it('warns about the platforms that gate or withdrew RTMP access', () => {
    // Being straight about this matters more than looking capable.
    expect(PLATFORMS.instagram.caveat).toMatch(/withdrew|no longer/i);
    expect(PLATFORMS.tiktok.caveat).toMatch(/LIVE access|follower/i);
    expect(PLATFORMS.youtube.caveat).toBeUndefined();
  });

  it('knows which shape each platform expects', () => {
    expect(PLATFORMS.youtube.prefers).toBe('landscape');
    expect(PLATFORMS.tiktok.prefers).toBe('portrait');
  });
});

describe('ingest URLs', () => {
  it('joins server and key', () => {
    expect(ingestUrl(dest({ server: 'rtmp://x/live', key: 'abc' }))).toBe('rtmp://x/live/abc');
  });

  it('tolerates a trailing slash on the server', () => {
    expect(ingestUrl(dest({ server: 'rtmp://x/live/', key: 'abc' }))).toBe('rtmp://x/live/abc');
  });

  it('trims whitespace pasted with a key', () => {
    expect(ingestUrl(dest({ server: 'rtmp://x/live', key: '  abc\n' }))).toBe('rtmp://x/live/abc');
  });

  it('falls back to the platform server when none is set', () => {
    expect(ingestUrl(dest({ platform: 'youtube', server: '', key: 'k' })))
      .toBe(`${PLATFORMS.youtube.server}/k`);
  });

  it('returns empty when there is no server at all', () => {
    expect(ingestUrl(dest({ platform: 'custom', server: '', key: 'k' }))).toBe('');
  });
});

describe('masking', () => {
  it('never shows the whole key', () => {
    const destination = dest({ server: 'rtmp://x/live', key: 'super-secret-key' });
    const masked = maskedUrl(destination);
    expect(masked).not.toContain('super-secret-key');
    expect(masked).toContain('••••');
  });

  it('shows the last few characters so a key can be recognised', () => {
    expect(maskedUrl(dest({ server: 'rtmp://x/live', key: 'abcdefgh' }))).toContain('efgh');
  });

  it('does not leak a short key', () => {
    expect(maskedUrl(dest({ server: 'rtmp://x/live', key: 'ab' }))).not.toContain('ab');
  });

  it('handles a destination with no key', () => {
    expect(maskedUrl(dest({ server: 'rtmp://x/live', key: '' }))).toBe('rtmp://x/live');
  });
});

describe('validation', () => {
  it('accepts a complete destination', () => {
    expect(validateDestination(dest({ server: 'rtmp://x/live', key: 'k' }))).toBeNull();
  });

  it('rejects a missing key', () => {
    expect(validateDestination(dest({ key: '' }))?.message).toMatch(/stream key/i);
  });

  it('rejects a non-RTMP server', () => {
    expect(validateDestination(dest({ server: 'https://example.com', key: 'k' }))?.message)
      .toMatch(/rtmp/i);
  });

  it('rejects a blank server on a custom destination', () => {
    expect(validateDestination(dest({ platform: 'custom', server: '', key: 'k' }))?.message)
      .toMatch(/ingest server/i);
  });

  it('ignores disabled destinations when checking them all', () => {
    const problems = validateAll([
      dest({ server: 'rtmp://x/live', key: 'k' }),
      dest({ key: '', enabled: false }),
    ]);
    expect(problems).toEqual([]);
  });

  it('reports every enabled destination that is incomplete', () => {
    expect(validateAll([dest({ key: '' }), dest({ key: '' })])).toHaveLength(2);
  });
});

describe('format advice', () => {
  it('warns when pushing landscape to a vertical platform', () => {
    expect(formatWarning(dest({ platform: 'tiktok' }), 'landscape')).toMatch(/vertical/i);
  });

  it('warns when pushing portrait to YouTube', () => {
    expect(formatWarning(dest({ platform: 'youtube' }), 'portrait')).toMatch(/horizontal/i);
  });

  it('stays quiet when the shapes agree', () => {
    expect(formatWarning(dest({ platform: 'youtube' }), 'landscape')).toBeNull();
    expect(formatWarning(dest({ platform: 'tiktok' }), 'portrait')).toBeNull();
  });

  it('never warns about a custom destination', () => {
    expect(formatWarning(dest({ platform: 'custom' }), 'portrait')).toBeNull();
  });
});

describe('stored destinations', () => {
  it('returns an empty list for junk', () => {
    expect(normalizeDestinations(null)).toEqual([]);
    expect(normalizeDestinations('nope')).toEqual([]);
  });

  it('round-trips a saved destination', () => {
    const original = dest({ server: 'rtmp://x/live', key: 'k', name: 'Main' });
    const [restored] = normalizeDestinations(JSON.parse(JSON.stringify([original])));
    expect(restored).toMatchObject({ server: 'rtmp://x/live', key: 'k', name: 'Main', platform: 'youtube' });
  });

  it('falls back to custom for an unknown platform', () => {
    const [restored] = normalizeDestinations([{ platform: 'myspace', key: 'k' }]);
    expect(restored.platform).toBe('custom');
  });

  it('defaults enabled to true but honours false', () => {
    expect(normalizeDestinations([{ platform: 'youtube' }])[0].enabled).toBe(true);
    expect(normalizeDestinations([{ platform: 'youtube', enabled: false }])[0].enabled).toBe(false);
  });
});
