import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

/**
 * These tests run against a machine with no cameras, no microphones and MIDI
 * permission denied — the configuration that previously left every control in
 * the app disabled. The app must still be fully navigable and must say what is
 * wrong rather than silently showing empty lists.
 */

const fakeDevices: MediaDeviceInfo[] = [
  { deviceId: 'cam-1', kind: 'videoinput', label: 'Studio Camera', groupId: 'g1', toJSON: () => ({}) } as MediaDeviceInfo,
  { deviceId: 'mic-1', kind: 'audioinput', label: 'USB Microphone', groupId: 'g2', toJSON: () => ({}) } as MediaDeviceInfo,
  { deviceId: 'out-1', kind: 'audiooutput', label: 'Studio Monitors', groupId: 'g3', toJSON: () => ({}) } as MediaDeviceInfo,
];

function stubAudio() {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(), cancelAndHoldAtTime: vi.fn(),
  });
  const node = () => ({
    connect: vi.fn(), disconnect: vi.fn(), gain: param(), frequency: param(),
    threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
    fftSize: 1024, smoothingTimeConstant: 0, getFloatTimeDomainData: vi.fn(),
    start: vi.fn(), stop: vi.fn(), type: 'sine', onended: null,
  });
  class FakeAudioContext {
    state = 'running';
    currentTime = 0;
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

beforeEach(() => {
  vi.restoreAllMocks();
  stubAudio();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    // Run a single frame, then stop, so the meter loop does not spin in tests.
    return 0 as unknown as number;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: vi.fn().mockResolvedValue(fakeDevices),
      getUserMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')),
      getDisplayMedia: vi.fn().mockRejectedValue(new Error('no capture')),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  // MIDI permission denied — the case that used to blank every device list.
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')),
  });
});

describe('workspace navigation', () => {
  it('opens every workspace', async () => {
    render(<App />);
    for (const [label, heading] of [
      ['Devices', 'Devices'], ['Mixer', 'Mixer'], ['Library', 'Library'], ['Settings', 'Settings'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}$`) }));
      expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeInTheDocument();
    }
  });

  it('switches settings sections', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Settings$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Audio & MIDI/ }));
    expect(await screen.findByRole('heading', { name: 'Audio & MIDI', level: 2 })).toBeInTheDocument();
  });
});

describe('device failures degrade gracefully', () => {
  it('still lists cameras and microphones when MIDI permission is denied', async () => {
    // This is the regression that made the whole app look greyed out: the MIDI
    // rejection used to abort the same code path that populated media devices.
    render(<App />);
    await waitFor(() => {
      expect(screen.getByLabelText('Camera')).toHaveValue('cam-1');
    });
    expect(within(screen.getByLabelText('Camera')).getByText('Studio Camera')).toBeInTheDocument();
    expect(screen.getByLabelText('Audio output')).toBeInTheDocument();
  });

  it('explains why MIDI is unavailable rather than claiming a device is connected', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Devices$/ }));
    expect(await screen.findByText(/BLOCKED|NO DEVICE|UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.queryByText('CONNECTED')).not.toBeInTheDocument();
  });

  it('reports blocked capture permission on the Devices page', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Devices$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Connect devices/ }));
    expect(await screen.findByText(/blocked/i)).toBeInTheDocument();
  });
});

describe('mixer', () => {
  it('always shows the instrument channel with a working mute', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Mixer$/ }));
    const mute = await screen.findByRole('button', { name: /Mute Piano \/ MIDI instrument/ });
    expect(mute).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(mute);
    await waitFor(() => expect(mute).toHaveAttribute('aria-pressed', 'true'));
  });

  it('toggles the master limiter', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Mixer$/ }));
    const limiter = await screen.findByRole('button', { name: /LIMITER/ });
    expect(limiter).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(limiter);
    await waitFor(() => expect(limiter).toHaveAttribute('aria-pressed', 'false'));
  });
});

describe('virtual keyboard', () => {
  it('renders a labelled, playable key range', async () => {
    render(<App />);
    // Default range is 61 keys, C2..C7.
    expect(await screen.findByRole('button', { name: 'C4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'F#4' })).toBeInTheDocument();
  });

  it('does not play notes while typing in a text field', async () => {
    render(<App />);
    const field = await screen.findByLabelText('Lesson headline');
    fireEvent.keyDown(field, { key: 'w', target: field });
    // 'w' maps to C#4; typing must not sound it.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'C#4' })).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
