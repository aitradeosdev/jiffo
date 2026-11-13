import { defineConfig } from 'vitest/config';

// Unit tests for the plain TypeScript parts (API client, helpers). Screens are checked in the web build.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
