/**
 * The capability guard.
 *
 * The one rule this file exists to enforce: **a capability is checked at the
 * operation, on the server.** Hiding a button is a courtesy to the operator; it is
 * not a permission. Every hidden control in this product is one HTTP request away
 * from a person who has the URL.
 *
 * A mismatch between the session's company and the company in the path answers
 * **404, not 403** — a 403 confirms that the other company exists, which is
 * information a stranger should not be able to obtain by guessing.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { companyCan, platformCan, type Capability } from '@sq/contracts';
import type { SessionRecord } from './sessions.js';
import { sendFail } from './http.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The resolved session, when a route required one. */
    session?: SessionRecord;
  }
}

/** Read the session a hook attached, or refuse. */
export function requireSession(request: FastifyRequest, reply: FastifyReply): SessionRecord | null {
  if (request.session === undefined) {
    sendFail(reply, 'unauthorized', 'Sign in to continue.');
    return null;
  }
  return request.session;
}

/**
 * Require a company capability.
 *
 * Platform staff hold no company capability on purpose: being licence-vendor staff
 * says nothing about which customer's margin a person may read.
 */
export function requireCompanyCapability(
  request: FastifyRequest,
  reply: FastifyReply,
  capability: Capability,
): SessionRecord | null {
  const session = requireSession(request, reply);
  if (session === null) return null;

  if (session.role === null || !companyCan(session.role, capability)) {
    sendFail(reply, 'forbidden', 'Your role does not allow this.');
    return null;
  }

  // A forced password change blocks everything except the change itself. Read live
  // from the session, which is read live from the row.
  if (session.mustChangePassword) {
    sendFail(reply, 'forbidden', 'Change your password before continuing.');
    return null;
  }

  return session;
}

/** Require a platform capability. */
export function requirePlatformCapability(
  request: FastifyRequest,
  reply: FastifyReply,
  capability: Capability,
): SessionRecord | null {
  const session = requireSession(request, reply);
  if (session === null) return null;

  if (session.platformRole === null || !platformCan(session.platformRole, capability)) {
    sendFail(reply, 'forbidden', 'Your role does not allow this.');
    return null;
  }

  return session;
}

/**
 * Refuse when the path's company is not the session's company.
 *
 * 404 rather than 403: a 403 tells the caller the company exists.
 */
export function requireSameTenant(
  session: SessionRecord,
  tenantIdInPath: string,
  reply: FastifyReply,
): boolean {
  if (session.tenantId !== tenantIdInPath) {
    sendFail(reply, 'not_found', 'Not found.');
    return false;
  }
  return true;
}
