/**
 * Opening the application database.
 *
 * **Postgres, everywhere.** The application database used to have a SQLite driver as an offline
 * fallback; it is gone (DECISIONS, D1). One driver means one set of SQL semantics to reason about,
 * one place where a concurrent write is handled properly, and no hidden divergence between a
 * developer's laptop and the server. SQLite still exists in this product, but only as the **file
 * format of a price book** (`packages/core/src/lib/pricing/sqliteRuntime.ts`) — content-addressed,
 * read-only, and never the application database.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { Db } from './driver.js';
import { createPostgresDb } from './postgres.js';

/**
 * The workspace root.
 *
 * Relative paths in configuration are resolved from here rather than from
 * `process.cwd()`, because `pnpm --filter <pkg> <script>` runs the script **inside the
 * package directory**. With cwd-relative resolution, `pnpm db:seed` from the root and
 * `pnpm --filter @sq/api seed` open two different database files — one migrated, one
 * empty — and the second reports "no such table: users" while looking perfectly
 * healthy.
 *
 * Falls back to the current directory outside a workspace (a deployed build has no
 * `pnpm-workspace.yaml`, and its paths are absolute anyway).
 */
function workspaceRoot(from: string = process.cwd()): string {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const cut = dir.lastIndexOf(sep);
    if (cut <= 0) return from;
    dir = dir.slice(0, cut);
  }
}

/**
 * Resolve a configured path: absolute stays as it is, relative starts at the workspace root.
 *
 * Exported because every configured path needs it. Under `pnpm --filter` the working directory is
 * the package's, so `./assets/logo.png` read from there is a different file — or none at all. The
 * platform logo hit exactly that: the setting was present, the API ran, and documents printed the
 * text logo because a relative path had resolved against the wrong directory.
 */
export function resolveFromRoot(value: string): string {
  if (isAbsolute(value)) return value;
  if (value === ':memory:') return value;
  return resolve(workspaceRoot(), value);
}

/** What the application needs to know to open a database. */
export interface DbConfig {
  driver: 'postgres';
  /** Connection URL. */
  url?: string;
}

/** Read the configuration from the environment. */
export function dbConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const driver = (env.DB_DRIVER ?? 'postgres').toLowerCase();

  /*
   * A named refusal, not a generic "unsupported value".
   *
   * Someone with an old checkout — or an old deployment note — will set `DB_DRIVER=sqlite` and get a
   * message that tells them what changed and what to do instead. "DB_DRIVER must be postgres, got
   * sqlite" would be technically true and useless.
   */
  if (driver === 'sqlite') {
    throw new Error(
      'DB_DRIVER=sqlite is no longer supported: the application database is Postgres everywhere ' +
        '(DECISIONS D1). Set DATABASE_URL.',
    );
  }

  if (driver !== 'postgres') {
    // An unrecognised value must not silently pick a default: a typo in production would otherwise
    // connect to whatever DATABASE_URL happens to say and look healthy while serving other data.
    throw new Error(`DB_DRIVER must be 'postgres', got '${driver}'.`);
  }

  const url = env.DATABASE_URL;
  if (url === undefined || url.trim() === '') {
    throw new Error(
      'DATABASE_URL is required: the application database is Postgres (DECISIONS D1). ' +
        'Nothing was opened.',
    );
  }
  return { driver: 'postgres', url };
}

/** Open the database described by `config`. */
export function openDb(config: DbConfig): Db {
  return createPostgresDb({ url: config.url as string });
}
