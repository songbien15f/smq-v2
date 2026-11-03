/**
 * Install a company. Run once, on a fresh database; `--if-empty` makes it safe to re-run.
 *
 * ```bash
 * COMPANY_NAME="ABC Sheds Pty Ltd" \
 * COMPANY_CODE=ABC \
 * COMPANY_ADMIN_EMAIL=owner@abcsheds.com.au \
 * COMPANY_ADMIN_PASSWORD="…" \
 * pnpm install:company
 * ```
 *
 * `COMPANY_CODE` is the short business code a person types at the sign-in screen, and
 * `COMPANY_ADMIN_USERNAME` defaults to the part of the email before the `@`. The report at the end
 * prints both, because those two plus the password are the credentials.
 *
 * ## Why this is a script and not a screen
 *
 * Booting a brand-new installation has a chicken and an egg: creating a company over HTTP needs a
 * platform capability, and granting a capability needs an administrator. This script is how that
 * first administrator comes to exist.
 *
 * ## It refuses to guess
 *
 * No default name, no default email, no generated password printed to a log. An installation that
 * quietly became "Demo Company" with a password in a terminal scrollback is an installation
 * nobody can account for later.
 */

import { dbConfigFromEnv, newId, now, openDb } from '@sq/db';
import type { Db } from '@sq/db';
import { hashPassword } from '../src/lib/password.js';
import { createCompany, countCompanies } from '../src/lib/company.js';

/**
 * Create the administrator who runs the *installation*, when asked.
 *
 * Optional, and separate from the company administrator, because they are different people
 * with different reach: a company administrator manages one company's staff and prices, while
 * a platform administrator manages the installation itself — the company's seats, the
 * published price book, the template catalogue.
 *
 * Skipped when the email is not given, rather than defaulted. A platform administrator with a
 * password from a script is the shape of the old server's hardcoded `dev`/`vegun` accounts,
 * and those were the accounts a stranger could use to reach every customer.
 */
async function ensurePlatformAdmin(db: Db, email: string, password: string, displayName: string): Promise<void> {
  const existing = await db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]);
  if (existing !== null) {
    process.stdout.write(`  platform   ${email} (already exists)\n`);
    return;
  }

  const at = now();
  await db.run(
    `INSERT INTO users (id, email, display_name, password_hash, must_change_password, password_set_at, platform_role, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, 'platform_admin', ?, ?)`,
    [newId(), email, displayName, await hashPassword(password), at, at, at],
  );
  process.stdout.write(`  platform   ${email} (platform_admin)\n`);
}

/** A required environment value, or a refusal that names what is missing. */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    process.stderr.write(
      `${name} is required and has no default.\n\n` +
        'COMPANY_NAME="ABC Sheds Pty Ltd" \\\n' +
        'COMPANY_ADMIN_EMAIL=owner@abcsheds.com.au \\\n' +
        'COMPANY_ADMIN_PASSWORD="…" \\\n' +
        'COMPANY_SLUG=abc-sheds \\\n' +
        '  pnpm install:company\n',
    );
    process.exit(1);
  }
  return value.trim();
}

async function main(): Promise<void> {
  const name = required('COMPANY_NAME');
  const adminEmail = required('COMPANY_ADMIN_EMAIL').toLowerCase();
  const password = required('COMPANY_ADMIN_PASSWORD');

  // 12 is the same floor the change-password form enforces. Checked here too, because a
  // short password set at install is a password nobody will revisit.
  if (password.length < 12) {
    process.stderr.write('COMPANY_ADMIN_PASSWORD must be at least 12 characters.\n');
    process.exitCode = 1;
    return;
  }

  // A slug from the name when none is given, so a small install needs one fewer decision.
  const slug = (process.env.COMPANY_SLUG ?? name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);

  // The business code a person types to reach this company. Defaults to the same shape migration
  // 009 derives for existing rows, so an installed company and a migrated one look alike.
  const code = (process.env.COMPANY_CODE ?? slug)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 16);
  if (code === '') {
    process.stderr.write('COMPANY_CODE produced an empty value. Use letters, digits or dashes.\n');
    process.exitCode = 1;
    return;
  }

  const adminUsername = process.env.COMPANY_ADMIN_USERNAME ?? adminEmail.split('@')[0] ?? 'admin';

  const seats = Number(process.env.COMPANY_SEATS ?? 5);
  const displayName = process.env.COMPANY_ADMIN_NAME ?? 'Company Administrator';

  const config = dbConfigFromEnv();
  const db = openDb(config);

  try {
    /*
     * `--if-empty` is how the launcher runs this.
     *
     * Without it the installer refuses to run on a database that already has a company, which is
     * the right behaviour for a person and the wrong one for a start script: a second run would
     * stop with an error and the operator would see a failed install for a machine that is already
     * installed. The flag asks this script to skip instead of refuse.
     */
    const ifEmpty = process.argv.includes('--if-empty');

    const existing = await countCompanies(db);
    if (existing > 0 && ifEmpty) {
      process.stdout.write('A company already exists. Left alone (--if-empty).\n');
      return;
    }
    if (existing > 0) {
      process.stderr.write(
        `This database already holds ${existing} company. The installer creates one and refuses to run here.\n` +
          'Nothing was changed. To reinstall, start from an empty database.\n',
      );
      process.exitCode = 1;
      return;
    }

    const created = await createCompany(
      db,
      {
        name,
        code,
        slug,
        abn: process.env.COMPANY_ABN ?? null,
        seats: Number.isFinite(seats) && seats > 0 ? seats : 5,
        subscriptionEndsAt: process.env.COMPANY_SUBSCRIPTION_ENDS ?? null,
        adminEmail,
        adminDisplayName: displayName,
        adminUsername,
        adminPasswordHash: await hashPassword(password),
        // The password was chosen by the operator, not sent through a chat window, so there
        // is nothing to force them to replace.
        mustChangePassword: false,
      },
    );

    process.stdout.write(
      `\nInstalled.\n\n` +
        `  company    ${name}\n` +
        `  code       ${code}      <- typed at sign-in\n` +
        `  slug       ${slug}\n` +
        `  tenant id  ${created.tenantId}\n` +
        `  admin      ${adminUsername} (${adminEmail})\n` +
        `  seats      ${seats}\n`,
    );

    // Optional: the person who administers the installation, rather than the company.
    const platformEmail = process.env.PLATFORM_ADMIN_EMAIL;
    const platformPassword = process.env.PLATFORM_ADMIN_PASSWORD;
    if (platformEmail !== undefined && platformEmail.trim() !== '') {
      if (platformPassword === undefined || platformPassword.length < 12) {
        process.stderr.write(
          'PLATFORM_ADMIN_PASSWORD must be at least 12 characters when PLATFORM_ADMIN_EMAIL is set.\n' +
            'The company was installed; no platform administrator was created.\n',
        );
        process.exitCode = 1;
      } else {
        await ensurePlatformAdmin(
          db,
          platformEmail.trim().toLowerCase(),
          platformPassword,
          process.env.PLATFORM_ADMIN_NAME ?? 'Platform Administrator',
        );
      }
    } else {
      process.stdout.write(
        '  platform   (none — administrative screens are unreachable until one exists)\n' +
          '             Re-run with PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD to add one.\n',
      );
    }

    process.stdout.write(
      '\nSign in at the client app and change nothing — the password you set is the password in force.\n' +
        'Next: publish the price book, then add the company\'s people.\n',
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
