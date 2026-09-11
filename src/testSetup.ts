import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Vitest is not configured with `globals: true`, so Testing Library's automatic
// cleanup never registers. Without this, every render leaks into the next test.
afterEach(() => cleanup());

/**
 * jsdom implements neither of these, and the scene editor uses both: it
 * measures its container to fit the canvas, and draws the programme output.
 * Stubbing them keeps the tests exercising the real components rather than a
 * fallback path the app never takes in a browser.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement['getContext'];
}
