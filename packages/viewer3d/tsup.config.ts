import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'esnext',
  dts: true,
  sourcemap: true,
  tsconfig: 'tsconfig.build.json',
  /*
   * React, three and the two R3F packages stay **external**: the apps already bundle exactly one copy
   * of each, and a second copy of `three` in a bundle means two different `THREE` objects, where
   * `instanceof` and the renderer's registry silently disagree. That failure reads as "the model is
   * blank", not as a dependency problem.
   */
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'three',
    '@react-three/fiber',
    '@react-three/drei',
    '@sq/core',
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
    options.jsxImportSource = 'react';
  },
});
