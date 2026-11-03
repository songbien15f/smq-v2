/**
 * Reply helpers, so every route answers the same shape.
 *
 * `@sq/contracts` defines the envelope; this file is the only place that writes it
 * to a response. A route that builds its own `{ ok, data }` by hand is how the three
 * mutually incompatible success shapes of the old server came to exist.
 */

import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { fail, ok, STATUS_FOR, zodDetails, type ErrorCode } from '@sq/contracts';

/** Answer 200 with a payload. */
export function sendOk<T>(reply: FastifyReply, data: T, status = 200): FastifyReply {
  return reply.status(status).send(ok(data));
}

/** Answer with a failure, using the status the code implies. */
export function sendFail(
  reply: FastifyReply,
  code: ErrorCode,
  message: string,
  details?: { path: string; message: string }[],
): FastifyReply {
  return reply.status(STATUS_FOR[code]).send(fail(code, message, details));
}

/**
 * Validate a body against a Zod schema.
 *
 * Returns the parsed value, or `null` after having already sent a 422. The route
 * reads `if (body === null) return;` — the alternative, throwing and having a global
 * error handler rebuild field errors, loses the field paths that a form needs to put
 * the message under the right input.
 */
export function parseBody<T extends z.ZodType>(
  schema: T,
  body: unknown,
  reply: FastifyReply,
): z.infer<T> | null {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;

  sendFail(reply, 'validation_failed', 'Some fields need attention.', zodDetails(parsed.error));
  return null;
}

/** A pagination query with sane bounds, so a caller cannot ask for a million rows. */
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

/** Read the client IP, preferring the proxy's forwarded header when present. */
export function clientIp(headers: Record<string, unknown>, fallback: string | undefined): string {
  const forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    // The first hop is the client; the rest are proxies.
    const first = forwarded.split(',')[0];
    if (first !== undefined && first.trim() !== '') return first.trim();
  }
  return fallback ?? 'unknown';
}
