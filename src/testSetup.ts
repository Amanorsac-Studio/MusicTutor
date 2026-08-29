import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest is not configured with `globals: true`, so Testing Library's automatic
// cleanup never registers. Without this, every render leaks into the next test.
afterEach(() => cleanup());
