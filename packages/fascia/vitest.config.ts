/// <reference types="vitest" />

import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Blocks import their primitives through the package's own name
      // (`@artloupe/fascia/components/ui/button`), which resolves via the exports
      // map when an app imports them. Running vitest inside this package has no
      // such self-link, so point the specifier back at the source.
      '@artloupe/fascia': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: [['text', { maxCols: 160 }], 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/test-setup.ts'],
    },
  },
});
