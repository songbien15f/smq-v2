import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Tests run against source, not `dist`. The alias mirrors tsconfig so a test and
 * the build resolve `@/...` to the same file — a test that passes against a stale
 * build is worse than no test.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
