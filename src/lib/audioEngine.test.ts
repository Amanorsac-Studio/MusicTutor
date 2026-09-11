import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Minimal AudioContext stand-in; the engine only needs the graph to exist. */
function stubAudioContext() {
  const param = () => ({
    value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(), cancelAndHoldAtTime: vi.fn(),
  });
  const node = () => ({
    connect: vi.fn(), disconnect: vi.fn(), gain: param(), frequency: param(),
    threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
    fftSize: 1024, smoothingTimeConstant: 0, getFloatTimeDomainData: vi.fn(),
    start: vi.fn(), stop: vi.fn(), onended: null,
  });
  class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    sampleRate = 48000;
    destination = node();
    createGain = vi.fn(node);
    createAnalyser = vi.fn(node);
    createOscillator = vi.fn(node);
    createDynamicsCompressor = vi.fn(node);
    createMediaStreamSource = vi.fn(node);
    createMediaStreamDestination = vi.fn(() => ({ ...node(), stream: { getAudioTracks: () => [] } }));
    resume = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
}

import { dbToMeter, faderToGain, gainToDb, METER_FLOOR_DB } from './audioEngine';

describe('fader taper', () => {
  it('is silent at the bottom and unity at the top', () => {
    expect(faderToGain(0)).toBe(0);
    expect(faderToGain(1)).toBeCloseTo(1, 6);
  });

  it('increases monotonically', () => {
    let previous = -1;
    for (let position = 0; position <= 1.0001; position += 0.05) {
      const gain = faderToGain(position);
      expect(gain).toBeGreaterThanOrEqual(previous);
      previous = gain;
    }
  });

  it('puts the midpoint well below half gain, as a real console does', () => {
    const mid = faderToGain(0.5);
    expect(mid).toBeLessThan(0.35);
    expect(mid).toBeGreaterThan(0.1);
  });

  it('clamps positions above 1', () => {
    expect(faderToGain(2)).toBeCloseTo(1, 6);
  });
});

describe('gain and decibel conversion', () => {
  it('reports unity gain as 0 dB', () => {
    expect(gainToDb(1)).toBeCloseTo(0, 6);
  });

  it('reports half amplitude as about -6 dB', () => {
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 1);
  });

  it('reports silence as negative infinity', () => {
    expect(gainToDb(0)).toBe(-Infinity);
  });
});

describe('meter scaling', () => {
  it('puts full scale at the top and the noise floor at the bottom', () => {
    expect(dbToMeter(0)).toBeCloseTo(1, 6);
    expect(dbToMeter(METER_FLOOR_DB)).toBeCloseTo(0, 6);
  });

  it('clamps levels beyond the displayable range', () => {
    expect(dbToMeter(6)).toBe(1);
    expect(dbToMeter(-120)).toBe(0);
  });

  it('places -30 dBFS near the middle of the scale', () => {
    const mid = dbToMeter(-30);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});

describe('input capture constraints', () => {
  /**
   * These matter for the two things teachers actually plug in: a real keyboard
   * through an audio interface, and a plug-in host such as Kontakt routed
   * through a virtual cable. Browser speech processing would wreck both.
   */
  const captureConstraints = async (): Promise<MediaTrackConstraints> => {
    stubAudioContext();
    let seen: MediaStreamConstraints | undefined;
    const track = {
      kind: 'audio', label: 'Line In (Focusrite)', readyState: 'live', stop: vi.fn(),
      getSettings: () => ({ channelCount: 2, sampleRate: 48000 }),
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) => {
          seen = constraints;
          return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
        }),
      },
    });
    const { AudioEngine } = await import('./audioEngine');
    const engine = new AudioEngine();
    await engine.addInputChannel({ id: 'inst1', label: 'Instrument in', deviceId: 'line-1' });
    return (seen?.audio ?? {}) as MediaTrackConstraints;
  };

  it('disables every browser speech-processing stage', async () => {
    const audio = await captureConstraints();
    expect(audio.echoCancellation).toBe(false);
    expect(audio.noiseSuppression).toBe(false);
    expect(audio.autoGainControl).toBe(false);
  });

  it('asks for full-quality stereo', async () => {
    const audio = await captureConstraints();
    expect(audio.channelCount).toEqual({ ideal: 2 });
    expect(audio.sampleRate).toEqual({ ideal: 48000 });
  });

  it('pins the exact device rather than letting the browser choose', async () => {
    const audio = await captureConstraints();
    expect(audio.deviceId).toEqual({ exact: 'line-1' });
  });

  it('reports back what the device actually granted', async () => {
    stubAudioContext();
    const track = {
      kind: 'audio', label: 'Line In (Focusrite)', readyState: 'live', stop: vi.fn(),
      getSettings: () => ({ channelCount: 2, sampleRate: 48000 }),
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream)),
      },
    });
    const { AudioEngine } = await import('./audioEngine');
    const engine = new AudioEngine();
    const state = await engine.addInputChannel({ id: 'inst1', label: 'Instrument in', deviceId: 'line-1' });
    expect(state.connected).toBe(true);
    expect(state.channelCount).toBe(2);
    expect(state.sampleRate).toBe(48000);
    expect(state.trackLabel).toBe('Line In (Focusrite)');
  });

  it('keeps the strip on the desk when a device fails to open', async () => {
    stubAudioContext();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error('Device in use')) },
    });
    const { AudioEngine } = await import('./audioEngine');
    const engine = new AudioEngine();
    const state = await engine.addInputChannel({ id: 'inst1', label: 'Instrument in', deviceId: 'line-1' });
    expect(state.connected).toBe(false);
    expect(state.error).toBe('Device in use');
    expect(engine.listChannels().some(channel => channel.id === 'inst1')).toBe(true);
  });
});

describe('empty mixer slots', () => {
  it('creates a strip with no device so the desk is always complete', async () => {
    stubAudioContext();
    const { AudioEngine } = await import('./audioEngine');
    const engine = new AudioEngine();
    const state = engine.ensureChannel({ id: 'mic1', label: 'Microphone', isVoice: true });
    expect(state.connected).toBe(false);
    expect(state.isVoice).toBe(true);
    expect(engine.listChannels().map(c => c.id)).toContain('mic1');
  });

  it('does not duplicate an existing strip', async () => {
    stubAudioContext();
    const { AudioEngine } = await import('./audioEngine');
    const engine = new AudioEngine();
    engine.ensureChannel({ id: 'mic1', label: 'Microphone' });
    engine.ensureChannel({ id: 'mic1', label: 'Microphone' });
    expect(engine.listChannels().filter(c => c.id === 'mic1')).toHaveLength(1);
  });
});
