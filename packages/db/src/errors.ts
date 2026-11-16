/**
 * Error classification the application needs from the driver.
 *
 * The database is Postgres everywhere (DECISIONS D1), so these predicates read Postgres error codes
 * directly. They live here rather than in `apps/api` because more than one caller needs the same
 * answer: seat claiming retries on a unique violation, and the price-import path reports one as a
 * conflict. Two copies of `error.code === '23505'` is two places to get it wrong.
 */

/**
 * True when `error` is a Postgres **unique violation** (`23505`).
 *
 * The driver surfaces the original `pg` error, which carries a string `code`. Matching on the code
 * rather than on a message is the difference between a classification and a guess: the message text
 * is localised and versioned, the code is part of the protocol.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === '23505';
}

/**
 * True when `error` is a Postgres **foreign key violation** (`23503`).
 *
 * A row referencing a tenant or user that was deleted between the read and the write is a conflict
 * the caller can report, not a server fault.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === '23503';
}
