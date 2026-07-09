import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The DOM is stubbed per-test; jsdom would only get in the way.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
