/**
 * The public enquiry form.
 *
 * ## Why this route did not exist until now
 *
 * The site's own copy said "the enquiry form is wired to the API's public enquiry route … the
 * endpoint exists and is rate-limited". Neither half was true: there was no POST route, and nothing
 * in the repository had ever inserted into `enquiries`. The table, the admin list and the contract
 * all existed; the write did not. A page that promises a form and does not have one is the kind of
 * thing a customer discovers by typing into it.
 *
 * ## Why it is unauthenticated, and what guards it
 *
 * A person enquiring about a shed has no account — the whole point is that they are not a customer
 * yet. So the route is public, and three things stand in for authentication:
 *
 * - **A rate limit per address**, consumed *before* the insert, so a flood costs a row rather than
 *   a database write per request. The limit is deliberately tight: a real person sends one enquiry.
 * - **A honeypot field.** A bot fills every input it finds; a person never sees the hidden one. A
 *   filled honeypot is answered with the same success as a real enquiry, so the bot learns nothing.
 * - **Nothing is echoed back.** The answer is a fixed acknowledgement, never the stored row, so the
 *   route cannot be used to confirm what it recorded.
 *
 * ## Why the IP is hashed
 *
 * The limit needs a stable key per source; the record does not need to know who the person is. A
 * hash gives the first without storing an address, and the table's `ip_hash` column is nullable for
 * exactly this reason.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';
import { newId, now } from '@sq/db';
import { z } from 'zod';
import { clientIp, parseBody, sendFail, sendOk } from '../lib/http.js';
import { consume } from '../lib/rateLimit.js';
import { hashIp } from '../lib/tokens.js';

/**
 * What a person may send. Limits are generous for a real enquiry and small for a script.
 *
 * The honeypot is a **declared** optional field rather than an unknown one, because the schema is
 * `.strict()` and an unknown key is stripped on parse — which would have deleted the very field the
 * check depended on.
 */
const enquiryRequest = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().max(40).optional(),
    message: z.string().trim().min(1).max(4000),
    /** Where the form was: the landing page, a shared quote, a demo request. */
    source: z.enum(['contact', 'share', 'demo']).default('contact'),
    /**
     * A field no person can see and no person fills.
     *
     * Named plausibly so a script that fills every input still finds it. When it carries anything,
     * the request is a bot and is answered as though it succeeded.
     */
    company: z.string().max(200).optional(),
  })
  .strict();

/** How many enquiries one address may send, and over how long. */
const LIMIT = 3;
const WINDOW_MS = 60 * 60 * 1000;

export function registerEnquiries(app: FastifyInstance, db: Db): void {
  app.post('/enquiries', async (request, reply) => {
    const ip = hashIp(clientIp(request.headers as Record<string, unknown>, request.ip));

    // Before the body is even validated: a flood should cost a counter, not a parse.
    const limit = await consume(db, `enquiry:ip:${ip}`, LIMIT, WINDOW_MS);
    if (!limit.allowed) {
      return sendFail(
        reply,
        'rate_limited',
        'That is a lot of enquiries from one place. Please wait a little, or email us directly.',
      );
    }

    const body = parseBody(enquiryRequest, request.body, reply);
    if (body === null) return;

    /*
     * A filled honeypot is answered exactly like a real enquiry.
     *
     * A distinct answer — an error, a different status — tells the script which field gave it away,
     * and the next attempt leaves that field empty. Silence is the only useful response.
     */
    if (body.company !== undefined && body.company.trim() !== '') {
      return sendOk(reply, { received: true }, 201);
    }

    await db.run(
      `INSERT INTO enquiries (id, name, email, phone, message, source, handled, handled_by, handled_at, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)`,
      [newId(), body.name, body.email, body.phone ?? null, body.message, body.source, ip, now()],
    );

    // A fixed acknowledgement, never the stored row: the answer must not confirm what was recorded.
    return sendOk(reply, { received: true }, 201);
  });
}
