/**
 * Loading `node:sqlite` without letting a bundler rewrite the specifier.
 *
 * ## The problem this works around
 *
 * Both bundlers in use (esbuild and rolldown, behind `tsup`) rewrite a built-in
 * import's specifier to its bare name: `from 'node:fs'` becomes `from 'fs'`. For most
 * built-ins that is harmless, because Node still accepts the bare name. `sqlite` is
 * not one of those names — `node:sqlite` is the only way to reach it, and the
 * rewritten `'sqlite'` is resolved as a *package*, which does not exist. The build
 * succeeds and the first query fails at runtime, which is the worst possible place to
 * find out.
 *
 * Setting `external: ['node:sqlite']` does not help; the rewrite happens anyway.
 *
 * ## The fix
 *
 * The specifier is assembled from parts so it is not a literal a bundler can
 * recognise, and it is handed to `require` from `createRequire`. Nothing is
 * rewritten because nothing matches a pattern. `import('node:sqlite')` cannot be used
 * because the loader would then need the module synchronously.
 */

import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

const requireHere = createRequire(import.meta.url);

/** Assembled, not written out: see the comment above. */
const SQLITE_SPECIFIER: string = ['node', 'sqlite'].join(':');

const sqliteModule = requireHere(SQLITE_SPECIFIER) as { DatabaseSync: typeof DatabaseSyncType };

/** The synchronous SQLite connection class. */
export const DatabaseSync: typeof DatabaseSyncType = sqliteModule.DatabaseSync;

/**
 * The instance type, under the same name as the value.
 *
 * Callers import `DatabaseSync` and then use the name as both a constructor and a
 * type, which is how the upstream source spelled it. A value and a type may share a
 * name, so every existing annotation keeps working without a rename.
 */
export type DatabaseSync = InstanceType<typeof DatabaseSyncType>;

/** A file handle type, for callers that annotate. */
export type SqliteDatabase = InstanceType<typeof DatabaseSyncType>;
