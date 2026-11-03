import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // These tests open real SQLite files in a temp directory; running them
    // serially keeps a shared temp path from one file leaking into another.
    fileParallelism: false,
  },
});
