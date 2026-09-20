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

/**
 * A new installation starts with the default PIANO and BASS scenes. Most of
 * these tests are about editing a scene from nothing, so they begin with one
 * blank scene already stored, which is what a first launch used to give.
 */
function startWithBlankScene() {
  localStorage.setItem('pianotutor.scenes.v1', JSON.stringify({
    scenes: [{ id: 'scene_blank', name: 'My scene', layouts: {} }],
    activeSceneId: 'scene_blank',
  }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Scenes and settings persist to localStorage, so each test starts clean.
  localStorage.clear();
  startWithBlankScene();
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
      ['Devices', 'Devices'], ['Mixer', 'Mixer'], ['Stream', 'Stream'],
      ['Library', 'Library'], ['Settings', 'Settings'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}$`) }));
      // Five pages in a row; on a busy machine one second each is not enough.
      expect(await screen.findByRole('heading', { name: heading, level: 1 }, { timeout: 8000 })).toBeInTheDocument();
    }
  }, 60_000);

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
      expect(within(screen.getByLabelText('Microphone')).getByText('USB Microphone')).toBeInTheDocument();
    });
    expect(within(screen.getByLabelText('Audio output')).getByText('Studio Monitors')).toBeInTheDocument();

    // The camera reaches the scene editor as an addable source.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add source' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Face camera$/ }));
    await waitFor(() => {
      expect(within(screen.getByLabelText('Camera device')).getByText('Studio Camera')).toBeInTheDocument();
    });
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

/** Sources counted in the active format's layout, read from the scene row. */
function layoutCount(): number {
  const row = document.querySelector('.scene-row small');
  const match = row?.textContent?.match(/^(\d+) source/);
  return match ? Number(match[1]) : -1;
}

/**
 * Add a source to the starting scene. The button stays disabled until the
 * stored scenes have loaded, so wait for that rather than racing it.
 */
async function addSource(label: RegExp) {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add source' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
  fireEvent.click(await screen.findByRole('button', { name: label }));
}

describe('scene editing', () => {
  it('starts a new installation with the default PIANO and BASS scenes', async () => {
    localStorage.clear();
    render(<App />);
    expect(await screen.findByLabelText('Scene name: PIANO')).toBeInTheDocument();
    expect(screen.getByLabelText('Scene name: BASS')).toBeInTheDocument();
    // The first one is open, with its layout already in place.
    await waitFor(() => expect(layoutCount()).toBeGreaterThan(0));
  });

  it('keeps the scenes somebody already has instead of adding the defaults', async () => {
    render(<App />);
    expect(await screen.findByText(/Empty scene/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Scene name: PIANO')).not.toBeInTheDocument();
    expect(layoutCount()).toBe(0);
  });

  it('brings a deleted default scene back', async () => {
    render(<App />);
    expect(await screen.findByText(/Empty scene/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore default scenes' }));
    expect(await screen.findByLabelText('Scene name: PIANO')).toBeInTheDocument();
    expect(screen.getByLabelText('Scene name: BASS')).toBeInTheDocument();
    // Asked again, there is nothing left to add.
    fireEvent.click(screen.getByRole('button', { name: 'Restore default scenes' }));
    await waitFor(() => expect(screen.getAllByLabelText('Scene name: PIANO')).toHaveLength(1));
  });

  it('adds a source and lists it as a layer', async () => {
    render(<App />);
    await addSource(/Piano keyboard/);
    await waitFor(() => expect(layoutCount()).toBe(1));
    expect(screen.getByRole('button', { name: /Hide Virtual keyboard/ })).toBeInTheDocument();
  });

  it('exposes position and size for the selected source', async () => {
    render(<App />);
    await addSource(/Text/);
    const width = await screen.findByLabelText('Text W');
    fireEvent.change(width, { target: { value: '640' } });
    await waitFor(() => expect(screen.getByLabelText('Text W')).toHaveValue(640));
  });

  it('removes a source', async () => {
    render(<App />);
    await addSource(/Colour block/);
    fireEvent.click(await screen.findByRole('button', { name: /Remove source/ }));
    await waitFor(() => expect(layoutCount()).toBe(0));
  });

  it('hides a source without deleting it', async () => {
    render(<App />);
    await addSource(/Piano keyboard/);
    const hide = await screen.findByRole('button', { name: /Hide Virtual keyboard/ });
    fireEvent.click(hide);
    await waitFor(() => expect(screen.getByRole('button', { name: /Show Virtual keyboard/ })).toBeInTheDocument());
    expect(layoutCount()).toBe(1);
  });
});

describe('Devices and Tutorial stay in step', () => {
  it('adds a camera from the Devices page straight into the scene', async () => {
    render(<App />);
    // Wait for the starting scene before leaving the Tutorial tab.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add source' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: /^Devices$/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: /Add to scene/ }))[0]);

    // Back in the Tutorial, the camera is a real source on the canvas.
    fireEvent.click(screen.getByRole('button', { name: /^Tutorial$/ }));
    await waitFor(() => expect(layoutCount()).toBe(1));
    expect(screen.getByRole('button', { name: /Hide Face camera/ })).toBeInTheDocument();
  });

  it('offers exactly a face camera and a hand camera, not one card per device', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Devices$/ }));
    expect(await screen.findByRole('button', { name: /Preview Face camera/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Preview Hand camera/ })).toBeInTheDocument();
    // The device name appears as a choice inside the role, not as its own card.
    expect(screen.queryByRole('button', { name: /Preview Studio Camera/ })).not.toBeInTheDocument();
  });

  it('shapes a hand camera as a wide overhead strip', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add source' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /^Devices$/ }));
    const addButtons = await screen.findAllByRole('button', { name: /Add to scene/ });
    // The second card is the hand camera.
    fireEvent.click(addButtons[1]);
    fireEvent.click(screen.getByRole('button', { name: /^Tutorial$/ }));
    await waitFor(() => expect(screen.getByLabelText('Hand camera W')).toBeInTheDocument());
    const width = Number((screen.getByLabelText('Hand camera W') as HTMLInputElement).value);
    const height = Number((screen.getByLabelText('Hand camera H') as HTMLInputElement).value);
    expect(width).toBeGreaterThan(height * 2);
  });
});


/**
 * The output format buttons.
 *
 * Scoped to their own group: the second-shape switch beside them offers the
 * same names, and an unscoped query cannot tell the two apart.
 */
const formatButton = (name: RegExp) =>
  within(screen.getByRole('group', { name: 'Output format' })).getByRole('button', { name });

const secondShapeButton = (name: RegExp) =>
  within(screen.getByRole('group', { name: 'Second shape' })).getByRole('button', { name });
describe('output formats', () => {
  it('offers landscape, portrait and square', async () => {
    render(<App />);
    await waitFor(() => expect(formatButton(/Landscape/)).toBeInTheDocument());
    expect(formatButton(/Portrait/)).toBeInTheDocument();
    expect(formatButton(/Square/)).toBeInTheDocument();
  });

  it('keeps a separate layout per format', async () => {
    render(<App />);
    await addSource(/Piano keyboard/);
    await waitFor(() => expect(layoutCount()).toBe(1));

    // Portrait starts empty — it is its own arrangement, not a squashed copy.
    fireEvent.click(formatButton(/Portrait/));
    await waitFor(() => expect(layoutCount()).toBe(0));
    expect(screen.getByText(/No sources in the portrait layout/)).toBeInTheDocument();

    // Switching back finds the landscape work intact.
    fireEvent.click(formatButton(/Landscape/));
    await waitFor(() => expect(layoutCount()).toBe(1));
  });

  it('can seed one format from another', async () => {
    render(<App />);
    await addSource(/Piano keyboard/);
    await waitFor(() => expect(layoutCount()).toBe(1));
    fireEvent.click(formatButton(/Portrait/));
    fireEvent.click(await screen.findByRole('button', { name: /Start from the landscape layout/ }));
    await waitFor(() => expect(layoutCount()).toBe(1));
  });

  it('reshapes the canvas when the format changes', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText(/1920 × 1080/)).toBeInTheDocument());
    fireEvent.click(formatButton(/Portrait/));
    await waitFor(() => expect(screen.getByText(/1080 × 1920/)).toBeInTheDocument());
  });
});

describe('scene ordering', () => {
  it('moves a scene up and down the running order', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add scene' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add scene' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Move / })).toHaveLength(4));

    const names = () => [...document.querySelectorAll('.scene-row input')]
      .map(input => (input as HTMLInputElement).value);
    const before = names();
    fireEvent.click(screen.getAllByRole('button', { name: /Move .* up/ })[1]);
    await waitFor(() => expect(names()).toEqual([before[1], before[0]]));
  });

  it('disables moving past the ends', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Move .* up/ })).toBeDisabled());
    expect(screen.getByRole('button', { name: /Move .* down/ })).toBeDisabled();
  });
});

describe('chord readout options', () => {
  it('can show names, numbers, or both', async () => {
    render(<App />);
    await addSource(/Chord readout/);
    const mode = await screen.findByLabelText('Chord display');
    expect(mode).toHaveValue('both');
    fireEvent.change(mode, { target: { value: 'numerals' } });
    // Choosing numbers reveals the size control for them.
    expect(await screen.findByLabelText('Number size')).toBeInTheDocument();
    fireEvent.change(mode, { target: { value: 'names' } });
    await waitFor(() => expect(screen.queryByLabelText('Number size')).not.toBeInTheDocument());
  });

  it('can make the numbers larger than the chord name', async () => {
    render(<App />);
    await addSource(/Chord readout/);
    const size = await screen.findByLabelText('Number size');
    fireEvent.change(size, { target: { value: '180' } });
    await waitFor(() => expect(screen.getByLabelText('Number size')).toHaveValue('180'));
  });
});

describe('key bar', () => {
  it('sets the key from under the canvas', async () => {
    render(<App />);
    const keyG = await screen.findByRole('button', { name: 'G' });
    fireEvent.click(keyG);
    await waitFor(() => expect(keyG).toHaveAttribute('aria-pressed', 'true'));
    // The scale readout follows the chosen key.
    expect(screen.getByLabelText('Notes in this key')).toHaveTextContent('G A B C D E F#');
  });

  it('switches between major and minor', async () => {
    render(<App />);
    const minor = await screen.findByRole('button', { name: 'minor' });
    fireEvent.click(minor);
    await waitFor(() => expect(minor).toHaveAttribute('aria-pressed', 'true'));
  });
});

describe('source zoom', () => {
  it('offers zoom on a camera, with pan once zoomed in', async () => {
    render(<App />);
    await addSource(/^Face camera$/);
    const zoom = await screen.findByLabelText('Zoom');
    expect(screen.queryByLabelText('Pan horizontally')).not.toBeInTheDocument();
    fireEvent.change(zoom, { target: { value: '200' } });
    expect(await screen.findByLabelText('Pan horizontally')).toBeInTheDocument();
    expect(screen.getByLabelText('Pan vertically')).toBeInTheDocument();
  });
});

describe('streaming', () => {
  it('explains that streaming needs the desktop app in a browser', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Stream$/ }));
    expect(await screen.findByText(/installed desktop app/i)).toBeInTheDocument();
  });

  it('will not go live until a destination has a key', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Stream$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /YouTube Live/ }));
    // A destination with no key cannot be streamed to.
    await waitFor(() => expect(screen.getByRole('button', { name: /Go live/ })).toBeDisabled());
    expect(screen.getByText(/No stream key entered/)).toBeInTheDocument();
  });

  it('clears the not-ready warning once a key is entered', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Stream$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /YouTube Live/ }));
    expect(await screen.findByText(/No stream key entered/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('YouTube Live stream key'), { target: { value: 'abcd-1234' } });
    await waitFor(() => expect(screen.queryByText(/No stream key entered/)).not.toBeInTheDocument());
    // Still disabled in a browser: there is no encoder outside the desktop app.
    expect(screen.getByRole('button', { name: /Go live/ })).toBeDisabled();
  });

  it('keeps the stream key hidden until asked', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Stream$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /YouTube Live/ }));
    const key = await screen.findByLabelText('YouTube Live stream key');
    expect(key).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: /Show stream key/ }));
    await waitFor(() => expect(screen.getByLabelText('YouTube Live stream key')).toHaveAttribute('type', 'text'));
  });

  it('is upfront about platforms that gate or withdrew RTMP', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Stream$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Instagram Live/ }));
    expect(await screen.findByText(/withdrew third-party RTMP/i)).toBeInTheDocument();
  });

  it('warns when the canvas shape does not suit the platform', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Stream$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /TikTok Live/ }));
    // The canvas defaults to landscape, which TikTok does not want.
    expect(await screen.findByText(/expects a vertical picture/i)).toBeInTheDocument();
  });
});

describe('virtual keyboard', () => {
  it('defaults to the full 88-key compass', async () => {
    render(<App />);
    await addSource(/Piano keyboard/);
    // A0 and C8 are the outer keys of a full piano.
    expect(await screen.findByRole('button', { name: 'A0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'C8' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'C4' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^[A-G]#?\d$/ })).toHaveLength(88);
  });

  it('can be switched to a shorter range', async () => {
    render(<App />);
    await addSource(/Piano keyboard/);
    fireEvent.change(await screen.findByLabelText('Keyboard range'), { target: { value: '36-96' } });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /^[A-G]#?\d$/ })).toHaveLength(61);
    });
    expect(screen.queryByRole('button', { name: 'A0' })).not.toBeInTheDocument();
  });

  it('does not play notes while typing in a text field', async () => {
    render(<App />);
    await addSource(/Piano keyboard/);
    const field = await screen.findByLabelText('Source name');
    fireEvent.keyDown(field, { key: 'w', target: field });
    // 'w' maps to C#4; typing must not sound it.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'C#4' })).toHaveAttribute('aria-pressed', 'false');
    });
  });
});

describe('two shapes at once', () => {
  it('offers every other shape as a second output', async () => {
    render(<App />);
    await waitFor(() => expect(formatButton(/Landscape/)).toBeInTheDocument());
    // Landscape is the main shape, so it is not offered as the second as well.
    expect(secondShapeButton(/Off/)).toBeInTheDocument();
    expect(secondShapeButton(/Portrait/)).toBeInTheDocument();
    expect(secondShapeButton(/Square/)).toBeInTheDocument();
  });

  it('starts with one shape only, so nothing is paid for until it is asked for', async () => {
    render(<App />);
    await waitFor(() => expect(secondShapeButton(/Off/)).toHaveAttribute('aria-pressed', 'true'));
  });

  it('turns a second shape on and shows it', async () => {
    render(<App />);
    await waitFor(() => expect(secondShapeButton(/Portrait/)).toBeInTheDocument());
    fireEvent.click(secondShapeButton(/Portrait/));
    await waitFor(() => expect(secondShapeButton(/Portrait/)).toHaveAttribute('aria-pressed', 'true'));
    expect(await screen.findByLabelText(/Portrait.*preview/i)).toBeInTheDocument();
  });

  it('drops the second shape when the main one becomes the same', async () => {
    render(<App />);
    await waitFor(() => expect(secondShapeButton(/Portrait/)).toBeInTheDocument());
    fireEvent.click(secondShapeButton(/Portrait/));
    await waitFor(() => expect(secondShapeButton(/Portrait/)).toHaveAttribute('aria-pressed', 'true'));

    // Making portrait the main shape would leave it composed twice.
    fireEvent.click(formatButton(/Portrait/));
    await waitFor(() => expect(secondShapeButton(/Off/)).toHaveAttribute('aria-pressed', 'true'));
  });
});
