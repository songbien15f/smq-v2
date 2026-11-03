/**
 * Publish and activate a price book from the command line.
 *
 * The same operation as `POST /admin/price-books`, for a machine being set up rather than a person
 * in the admin screen. `start-306.bat` needs it: the first run has no company and therefore nobody
 * who can sign in to publish anything.
 *
 *   pnpm publish-book                    # tools/price-dump/out
 *   pnpm publish-book -- --if-empty      # leave an existing book alone
 *   pnpm publish-book -- --dump <dir>
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { dbConfigFromEnv, openDb } from '@sq/db';
import { activeBookHash, publishAndActivate } from '../src/lib/priceBook.js';

/** The workspace root, so a relative dump path means the same thing however this is run. */
function workspaceRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const cut = dir.lastIndexOf(sep);
    if (cut <= 0) return process.cwd();
    dir = dir.slice(0, cut);
  }
}

const args = process.argv.slice(2);

/** A flag's value, or the fallback. */
function arg(name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? (args[index + 1] as string) : fallback;
}

async function main(): Promise<void> {
  const ifEmpty = args.includes('--if-empty');
  const raw = arg('--dump', 'tools/price-dump/out');
  const dumpDir = isAbsolute(raw) ? raw : resolve(workspaceRoot(), raw);

  const db = openDb(dbConfigFromEnv());

  try {
    if (ifEmpty) {
      const active = await activeBookHash(db);
      if (active !== null) {
        process.stdout.write(`A book is already active (${active.slice(0, 12)}…). Left alone.\n`);
        return;
      }
    }

    if (!existsSync(dumpDir)) {
      // Not fatal for a launcher: without a book the app starts and the editor says so plainly,
      // which is a better first impression than a script refusing to run.
      process.stderr.write(
        `No dump at ${dumpDir}.\n` +
          'The price book is licensed supplier data and is not in the repository, so a fresh clone\n' +
          'has none. The application will start and refuse to price anything until one is published.\n',
      );
      process.exitCode = 2;
      return;
    }

    const published = await publishAndActivate(db, {
      dumpDir,
      publishedByUserId: 'cli',
      publishedByEmail: 'cli@publish-book',
      note: `Published from ${dumpDir}`,
    });

    process.stdout.write(
      `Published and activated.\n` +
        `  hash              ${published.hash}\n` +
        `  kind              ${published.kind}\n` +
        `  supplier codes    ${published.supplierCodeCount}\n`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
