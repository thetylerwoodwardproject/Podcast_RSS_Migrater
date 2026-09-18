import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Image fixtures are generated with sharp on first run rather than committed.
    globalSetup: ['tests/fixtures/globalSetup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
