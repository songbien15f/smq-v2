import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'esnext',
  dts: true,
  sourcemap: true,
  tsconfig: 'tsconfig.build.json',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  /**
   * The automatic JSX runtime, stated explicitly.
   *
   * esbuild defaults to the classic transform, which emits `React.createElement` and
   * expects `React` to be in scope. This package imports only the hooks it uses, so the
   * classic output references a `React` that does not exist — and the failure surfaces
   * at prerender time in a consuming app ("React is not defined"), a long way from the
   * package that caused it.
   */
  esbuildOptions(options) {
    options.jsx = 'automatic';
    options.jsxImportSource = 'react';
  },
});
