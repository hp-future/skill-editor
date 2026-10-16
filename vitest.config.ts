import { defineConfig } from 'vitest/config';

// Test-only configuration, kept separate from `vite.config.ts` so the library
// build stays free of test typings.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['vitest.setup.ts'],
    restoreMocks: true,
  },
});
