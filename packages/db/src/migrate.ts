/**
 * The migration runner.
 *
 * Three rules, each earned:
 *
 * 1. **Each migration runs inside one transaction.** A half-applied schema is worse
 *    than an absent one: the next run sees the version recorded or not, and neither
 *    answer is true.
 * 2. **An edited migration is refused.** The checksum of every applied file is
 *    stored. Editing a migration that has already run means two databases now have
 *    different schemas under the same version number, and the failure must be loud.
 *    To change a schema, add a file.
 * 3. **Dialect extras run after the portable file with the same prefix.** SQLite
 *    needs a trigger where Postgres needs a rule; the portable file carries the
 *    tables, and `migrations/sqlite/` or `migrations/pg/` carries the difference.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './driver.js';

/** One migration file, as the runner sees it. */
export interface MigrationFile {
  version: string;
  path: string;
  sql: string;
  checksum: string;
}

/** What one run did. */
export interface MigrationReport {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * sha256 of a file's text, so an edit is detectable.
 *
 * **Line endings are normalised to `\n` first.** Without that, a checkout on Windows — where
 * `core.autocrlf` turns every LF into CRLF — gives every migration a different checksum from
 * the one recorded on a machine that checked it out with LF, and `migrate` refuses to start
 * with "this migration has changed since it was applied" on a file nobody edited. The guard
 * is there to catch an **edit**, and a line-ending conversion is not one; normalising is what
 * makes the guard mean what it says on both platforms.
 */
function checksumOf(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * The folder holding a driver's dialect-specific migrations.
 *
 * **Always `pg`.** The application database is Postgres everywhere (DECISIONS D1), so the SQLite
 * folder is gone. The function stays because callers already pass its result, and a second
 * `join(MIGRATIONS, 'pg')` in each of them would be the same string spelled in four places.
 *
 * The version recorded for a dialect migration is `…@postgres` (see below), and that spelling must
 * not change: a database that has already applied those rows would otherwise see them as new and
 * try to run them twice.
 */
export function dialectFolderFor(): string {
  return 'pg';
}

/** Read every `.sql` file in `dir`, sorted by filename. */
export function readMigrations(dir: string): MigrationFile[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    throw new Error(`No migrations directory at ${dir}. Run from the repository root.`);
  }

  return names
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      const sql = readFileSync(path, 'utf8');
      return {
        version: name.replace(/\.sql$/, ''),
        path,
        sql,
        checksum: checksumOf(sql),
      };
    });
}

/**
 * The same, for a directory that is allowed to be absent.
 *
 * A driver with no dialect-specific extras — Postgres needs a rule where SQLite needs a
 * trigger, but a future driver might need nothing — is a normal state, not an error. The
 * portable file carries the tables, and the dialect folder carries only the difference.
 */
function readOptionalMigrations(dir: string): MigrationFile[] {
  try {
    return readMigrations(dir);
  } catch {
    return [];
  }
}

/**
 * Apply every migration in `dir` that has not run yet.
 *
 * `dialectDir` may be absent; when present, its files run after the portable file
 * whose numeric prefix matches, and are recorded under `portable@dialect` so the
 * two never collide in `schema_migrations`.
 */
export async function migrate(
  db: Db,
  dir: string,
  dialectDir?: string,
): Promise<MigrationReport> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL,
      checksum    TEXT NOT NULL
    )
  `);

  const applied = new Map<string, string>();
  const rows = await db.all<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations',
  );
  for (const row of rows) applied.set(row.version, row.checksum);

  const report: MigrationReport = { applied: [], alreadyApplied: [] };

  for (const file of readMigrations(dir)) {
    const previous = applied.get(file.version);

    if (previous !== undefined) {
      if (previous !== file.checksum) {
        throw new Error(
          `Migration ${file.version} has changed since it was applied (recorded ${previous.slice(0, 12)}, file ${file.checksum.slice(0, 12)}). ` +
            'Two databases now disagree under one version number. Add a new migration instead of editing this one.',
        );
      }
      report.alreadyApplied.push(file.version);
    } else {
      await db.transaction(async (tx) => {
        await tx.exec(file.sql);
        await tx.run(
          'INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)',
          [file.version, new Date().toISOString(), file.checksum],
        );
      });
      report.applied.push(file.version);
    }

    // The dialect file for this prefix, if one exists.
    if (dialectDir !== undefined) {
      const prefix = file.version.split('_')[0];
      const extras = readOptionalMigrations(dialectDir).filter((extra) =>
        extra.version.startsWith(`${prefix}_`),
      );
      for (const extra of extras) {
        const version = `${extra.version}@${db.driver}`;
        const seen = applied.get(version);
        if (seen !== undefined) {
          if (seen !== extra.checksum) {
            throw new Error(
              `Dialect migration ${extra.path} has changed since it was applied. Add a new migration instead.`,
            );
          }
          continue;
        }
        await db.transaction(async (tx) => {
          await tx.exec(extra.sql);
          await tx.run(
            'INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)',
            [version, new Date().toISOString(), extra.checksum],
          );
        });
        report.applied.push(version);
      }
    }
  }

  return report;
}
