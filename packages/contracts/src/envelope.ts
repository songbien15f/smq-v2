/**
 * The shape of every API answer.
 *
 * One envelope, because the original licence server answered three different ways
 * depending on the controller — a bare `int`, `{status:"1", message}` and
 * `{success, message, ...}` — and a client written against one of them silently
 * mis-read the other two. That is not a style preference; it is the defect this
 * shape exists to prevent.
 */

import { z } from 'zod';

/**
 * Machine-readable failure reasons.
 *
 * A client switches on `code`, never on `message`: the message is for a person and
 * will be reworded, while `code` is what a caller tests.
 */
export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'conflict',
  'rate_limited',
  'not_configured',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** A failed answer. `details` carries field errors for a form. */
export interface ApiFailure {
  ok: false;
  code: ErrorCode;
  message: string;
  details?: { path: string; message: string }[];
}

/** A successful answer. */
export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/** Build a success envelope. */
export function ok<T>(data: T): ApiSuccess<T> {
  return { ok: true, data };
}

/** Build a failure envelope. */
export function fail(
  code: ErrorCode,
  message: string,
  details?: { path: string; message: string }[],
): ApiFailure {
  return details === undefined ? { ok: false, code, message } : { ok: false, code, message, details };
}

/** The HTTP status each failure code maps to. */
export const STATUS_FOR: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  rate_limited: 429,
  not_configured: 503,
  internal: 500,
};

/** Turn a Zod failure into the `details` a form can render under each field. */
export function zodDetails(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/** A paginated list. Cursors rather than offsets: a quote inserted mid-scroll
 *  must not cause a row to be skipped or repeated. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number | null;
}
