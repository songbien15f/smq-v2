import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'esnext',
  dts: true,
  sourcemap: true,
  tsconfig: 'tsconfig.build.json',
  platform: 'node',
  external: ['pg'],
});
