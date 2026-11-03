/**
 * Loading `node:sqlite` without letting a bundler rewrite the specifier.
 *
 * See the identical helper in `@sq/core`'s `pricing/sqliteRuntime.ts` for the full
 * explanation. In short: the bundler rewrites `from 'node:sqlite'` to `from 'sqlite'`,
 * which is not a built-in and does not resolve; assembling the specifier from parts
 * defeats the rewrite.
 */

import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

const requireHere = createRequire(import.meta.url);

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
