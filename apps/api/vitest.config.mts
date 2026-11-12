import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC compiles the tests so Nest's dependency injection gets the decorator metadata it needs.
export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
