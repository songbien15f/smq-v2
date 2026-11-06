/**
 * The client app's test setup.
 *
 * Everything else in this workspace runs under plain Node — the engine, the database layer, the
 * contracts. This app is React, so its tests need a DOM and a JSX transform. `jsdom` and the React
 * plugin are the two pieces, and they live in this app rather than at the workspace root so the
 * Node-only packages do not pay for them.
 *
 * `globals: true` is deliberately off: a test that reads `describe` and `it` from an import is a
 * test that says where they came from.
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  /*
   * `@/` is the app's own alias, declared in `tsconfig.json` for Next's compiler. Vitest does not
   * read `tsconfig.paths`, so a test importing `@/store/useShedStore` fails to resolve while the
   * component importing the same path builds fine — a split where the test is the only thing that
   * cannot see the module. Declared once here rather than making tests use relative imports, so a
   * test imports its subject exactly the way the application does.
   */
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // `jest-dom` adds the matchers a form test reads naturally (`toHaveAttribute`); the React
    // testing library unmounts each render between tests so one test's DOM is never the next
    // test's duplicate match.
    setupFiles: ['./vitest.setup.ts'],
    restoreMocks: true,
  },
});
