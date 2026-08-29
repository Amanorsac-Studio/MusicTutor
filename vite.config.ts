import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: 'public',
  test: { environment: 'jsdom', setupFiles: './src/testSetup.ts' },
});
