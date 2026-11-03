/**
 * The API process.
 *
 * Boot order is deliberate: configuration, then the database, then the listener. A server that
 * accepts traffic before it can serve it produces errors instead of a failed health check.
 *
 * ## `.env`
 *
 * Loaded by a **Node flag**, not from this file: `--env-file-if-exists=.env` in the `dev` and
 * `start` scripts. That ordering matters. An ES module's imports are evaluated before its body
 * runs, so a `process.loadEnvFile()` written here would happen *after* every imported module
 * had already been initialised — fine today, because all of them read the environment inside a
 * function, and silently broken the day one of them reads it at module scope. The flag is
 * applied before any module loads, so that day cannot arrive.
 *
 * A missing file is not an error: a deployed container gets its configuration from the
 * environment. Variables already present win, so `DB_DRIVER=sqlite pnpm dev` still overrides
 * the file.
 */

import { dbConfigFromEnv, openDb } from '@sq/db';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { assertCompanyIsSingular } from './lib/company.js';
import { closeAllBooks } from './lib/priceBook.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const dbConfig = dbConfigFromEnv();
  const db = openDb(dbConfig);

  // Fail fast if the database is unreachable or unmigrated, rather than discovering it on,
  // the first request.
  try {
    await db.get('SELECT 1 AS one');
  } catch (error) {
    process.stderr.write(
      `The database is not reachable: ${error instanceof Error ? error.message : String(error)}\n` +
        'Check DB_DRIVER/DATABASE_URL or DB_FILE, and run `pnpm db:migrate`.\n',
    );
    process.exitCode = 1;
    return;
  }

  // One company, on purpose. A second row is a state the application cannot reason about —
  // which company would a quote belong to — so it stops the boot rather than half-working.
  if (dbConfig.singleCompany) {
    try {
      const count = await assertCompanyIsSingular(db);
      if (count === 0) {
        process.stderr.write(
          'No company yet. Provision one before serving:\n' +
            '  COMPANY_NAME="…" COMPANY_ADMIN_EMAIL="…" COMPANY_ADMIN_PASSWORD="…" pnpm install:company\n',
        );
      }
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      await db.close();
      process.exitCode = 1;
      return;
    }
  }

  const app = await buildApp({ db, config, logger: true });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    // Price books are held open for the process's life; releasing them here is what makes a
    // clean shutdown remove the temp directory a deployment may have put them in.
    closeAllBooks();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `API on http://localhost:${config.port}/api/v1 — driver ${db.driver}, ` +
      `origins ${config.allowedOrigins.join(', ') || '(none: browser calls will be refused)'}`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
