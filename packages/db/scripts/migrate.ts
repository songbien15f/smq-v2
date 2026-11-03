/**
 * Apply migrations. Run with `pnpm db:migrate` from the repository root.
 *
 * Prints what it did rather than exiting silently: "nothing to apply" and "the
 * directory was wrong" must not look the same.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbConfigFromEnv, openDb } from '../src/index.js';
import { dialectFolderFor, migrate } from '../src/migrate.js';

/** The workspace root — found by walking up to `pnpm-workspace.yaml`, so the
 *  command works from the package directory or the repository root. */
function workspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not find pnpm-workspace.yaml above this script.');
    dir = parent;
  }
}

async function main(): Promise<void> {
  const root = workspaceRoot();
  // The migrations ship next to this package's source, not inside `dist`.
  const migrationsDir = resolve(root, 'packages', 'db', 'migrations');
  const config = dbConfigFromEnv();

  process.stdout.write(`Database: ${config.driver}`);
  process.stdout.write(config.driver === 'sqlite' ? ` (${config.file})\n` : '\n');

  const db = openDb(config);
  try {
    const report = await migrate(db, migrationsDir, join(migrationsDir, dialectFolderFor(db.driver)));

    for (const version of report.alreadyApplied) {
      process.stdout.write(`  = ${version} (already applied)\n`);
    }
    for (const version of report.applied) {
      process.stdout.write(`  + ${version} applied\n`);
    }
    process.stdout.write(
      report.applied.length === 0
        ? 'Nothing to apply. The schema is up to date.\n'
        : `Applied ${report.applied.length} migration(s).\n`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
