/**
 * The price book's SQLite connection.
 *
 * A separate file from the usage log and from quotes, by purpose: a quote backup
 * must not carry visitor data, and a price re-import must not touch either.
 *
 * Server-only by construction — `node:sqlite` does not exist in a browser bundle.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from './sqliteRuntime.js';
import { applyPriceSchema } from './schema';

const DEFAULT_PATH = join(process.cwd(), 'data', 'pricing.db');

let cached: DatabaseSync | null = null;
let cachedPath: string | null = null;

/** Open (and prepare) the price book at `path`. `:memory:` is for tests. */
export function openPriceDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  applyPriceSchema(db);
  return db;
}

/** The process-wide price-book connection, opened on first use. */
export function getPriceDb(): DatabaseSync {
  const path = process.env.PRICE_DB ?? DEFAULT_PATH;
  if (cached !== null && cachedPath === path) return cached;
  cached = openPriceDb(path);
  cachedPath = path;
  return cached;
}

/** Drop the cached connection. Tests use this between cases. */
export function resetPriceDbForTests(): void {
  if (cached !== null) {
    try {
      cached.close();
    } catch {
      // Already closed by its owner is not an error.
    }
  }
  cached = null;
  cachedPath = null;
}
