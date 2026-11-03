/**
 * `/health` — liveness and readiness.
 *
 * Two answers, deliberately separate:
 *
 * - `live` means the process is running. A restart policy reads this.
 * - `ready` means the database answered. A load balancer reads this, and a 503 here
 *   takes the instance out of rotation instead of serving errors.
 *
 * Neither returns a version string or a stack trace: a health endpoint on the public
 * internet is a fingerprinting surface, and the operator already knows what is
 * deployed.
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from '@sq/db';

export function registerHealth(app: FastifyInstance, db: Db): void {
  app.get('/health', async (_request, reply) => {
    reply.status(200).send({ ok: true, data: { live: true } });
  });

  app.get('/health/ready', async (_request, reply) => {
    try {
      await db.get('SELECT 1 AS one');
      reply.status(200).send({ ok: true, data: { ready: true, database: db.driver } });
    } catch {
      // The reason is logged by the server, not returned: a database error message
      // can contain a host, a user name or a path.
      reply.status(503).send({ ok: false, code: 'not_configured', message: 'The database is not answering.' });
    }
  });
}
