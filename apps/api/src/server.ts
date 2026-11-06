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
import { closeAllBooks } from './lib/priceBook.js';
import { createSmtpTransport, mailIsConfigured, smtpConfigFromEnv } from './lib/mail/smtp.js';
import type { TransactionalDeps } from './lib/mail/transactional.js';
import { settleEnquiryNotifications } from './lib/mail/enquiryMail.js';

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

  // An empty database is a normal state now: the product serves one company or a dozen, and which
  // companies exist is an administrative fact, not a boot precondition. The one thing worth saying
  // out loud is that nobody can sign in yet, because the message names the command that fixes it.
  const companyCount = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tenants');
  if (Number(companyCount?.n ?? 0) === 0) {
    process.stderr.write(
      'No company yet. Provision one before serving:\n' +
        '  COMPANY_NAME="…" COMPANY_CODE="…" COMPANY_ADMIN_EMAIL="…" COMPANY_ADMIN_PASSWORD="…" pnpm install:company\n',
    );
  }

  /*
   * Mail for a reset link or an invitation, or `null` when this server has no SMTP.
   *
   * Built once here rather than per request: `createSmtpTransport` reads configuration that cannot
   * change without a restart, and the routes treat `null` as "answer 503", which is a fact worth
   * deciding at boot.
   */
  const mail: TransactionalDeps | null = mailIsConfigured()
    ? {
        transport: createSmtpTransport(smtpConfigFromEnv()),
        from: (process.env.MAIL_FROM ?? '').trim(),
        publicOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:3061',
      }
    : null;

  const app = await buildApp({ db, config, logger: true, mail });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    /*
     * An enquiry notification is still on its way, because the route answers before it finishes
     * (a real send through the relay takes several seconds). Dropping it here would lose the only
     * trace a lead ever reached anybody, so the restart waits — bounded by the budget inside, which
     * is generous but finite.
     */
    await settleEnquiryNotifications();
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
