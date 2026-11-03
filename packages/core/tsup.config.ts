import { defineConfig } from 'tsup';

/**
 * The alias `@/…` is kept in source rather than rewritten to relative paths.
 *
 * That is a deliberate cost/benefit: this package is extracted from an upstream
 * project that uses the same alias, and keeping it means a future fix can be
 * applied here and diffed there. Rewriting ~400 imports to relative paths would
 * make every future port a manual merge.
 *
 * Each layer is its own entry so a browser bundle can import `domain` and `bom`
 * without dragging `node:sqlite` and ExcelJS in through `pricing`.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'domain/index': 'src/domain/index.ts',
    'bom/index': 'src/lib/bom/index.ts',
    'pricing/index': 'src/lib/pricing/index.ts',
    'estimating/index': 'src/lib/estimating/index.ts',
    'documents/index': 'src/lib/documents/index.ts',
    // The legacy `.sqd` reader and writer. Its own entry because it touches `node:crypto`, so a
    // browser bundle must not pull it in through the root barrel.
    'quoteFile/index': 'src/lib/quoteFile/index.ts',
  },
  format: ['esm'],
  target: 'esnext',
  dts: true,
  sourcemap: true,
  splitting: true,
  tsconfig: 'tsconfig.build.json',
  // Resolved at runtime by the consumer: never bundle a native/binary dependency.
  external: ['exceljs', 'node:sqlite'],
});
