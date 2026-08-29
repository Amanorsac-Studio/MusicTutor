import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

beforeEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: vi.fn().mockResolvedValue([]),
      getUserMedia: vi.fn().mockRejectedValue(new Error('No test hardware')),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: vi.fn().mockResolvedValue({ inputs: new Map(), outputs: new Map(), onstatechange: null }),
  });
});

describe('PianoTutor desktop workspaces', () => {
  it('opens Devices, Mixer, Library, and Settings as interactive pages', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Devices/i }));
    expect(screen.getByRole('heading', { name: 'Devices' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Mixer/i }));
    expect(screen.getByRole('heading', { name: 'Mixer' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'M' })[0]);
    expect(screen.getAllByRole('button', { name: 'M' })[0]).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Library/i }));
    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Settings/i }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Audio & MIDI/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Audio & MIDI' })).toBeInTheDocument());
  });
});
