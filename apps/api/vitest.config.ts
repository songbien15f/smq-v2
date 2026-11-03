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
    /**
     * One file at a time.
     *
     * Not a preference — a correctness requirement. `makeTestApp` starts each file from a clean
     * database, and against Postgres that means **dropping every table in one shared database**.
     * Two files in parallel wipe each other's schema mid-run, and the symptom is a 500 from a
     * route that has nothing to do with the other file. SQLite's `:memory:` is per-connection and
     * never had the problem, so this only bites in the mode that matters most.
     */
    fileParallelism: false,
  },
});
