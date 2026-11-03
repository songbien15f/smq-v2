/**
 * Opening the application database.
 *
 * Which driver runs is decided by `DB_DRIVER`, and the default is SQLite so a fresh
 * checkout runs without a server. Everything above this function is driver-blind.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { Db } from './driver.js';
import { createSqliteDb } from './sqlite.js';
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

/** Resolve a configured path: absolute stays as it is, relative starts at the root. */
function resolveFromRoot(value: string): string {
  if (isAbsolute(value)) return value;
  if (value === ':memory:') return value;
  return resolve(workspaceRoot(), value);
}

/** What the application needs to know to open a database. */
export interface DbConfig {
  driver: 'sqlite' | 'postgres';
  /** Path for SQLite. */
  file?: string;
  /** Connection URL for Postgres. */
  url?: string;
}

/** Read the configuration from the environment. */
export function dbConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DbConfig {
  // Postgres is the target. SQLite is the offline fallback, for a developer box with no
  // server and for a single-machine install.
  const driver = (env.DB_DRIVER ?? 'postgres').toLowerCase();

  if (driver === 'postgres') {
    const url = env.DATABASE_URL;
    if (url === undefined || url.trim() === '') {
      throw new Error(
        'DB_DRIVER=postgres needs DATABASE_URL. Nothing was opened. ' +
          'For a run without Postgres, set DB_DRIVER=sqlite and DB_FILE.',
      );
    }
    return { driver: 'postgres', url };
  }

  if (driver !== 'sqlite') {
    // An unrecognised value must not silently pick a driver: a typo in production
    // would otherwise open a local file and look healthy while serving empty data.
    throw new Error(`DB_DRIVER must be 'sqlite' or 'postgres', got '${driver}'.`);
  }

  return {
    driver: 'sqlite',
    file: resolveFromRoot(env.DB_FILE ?? './data/app.db'),
  };
}

/** Open the database described by `config`. */
export function openDb(config: DbConfig): Db {
  if (config.driver === 'postgres') {
    return createPostgresDb({ url: config.url as string });
  }

  const file = config.file ?? resolveFromRoot('./data/app.db');
  if (file !== ':memory:') {
    // SQLite will not create a missing directory, and the failure it gives instead
    // ("unable to open database file") does not name the directory.
    mkdirSync(dirname(file), { recursive: true });
  }
  return createSqliteDb({ file });
}
