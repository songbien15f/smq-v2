import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', app: 'src/app.ts' },
  format: ['esm'],
  target: 'esnext',
  dts: false,
  clean: true,
  sourcemap: true,
  tsconfig: 'tsconfig.build.json',
  // Workspace packages and native modules are resolved at runtime, not bundled:
  // bundling `@sq/db` would inline `node:sqlite` and `pg` into one file and lose
  // the ability to pick a driver at boot.
  external: ['@sq/core', '@sq/contracts', '@sq/db', 'pg'],
});
