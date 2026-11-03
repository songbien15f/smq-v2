/**
 * The app factory.
 *
 * `buildApp` takes its dependencies and returns a Fastify instance that has not
 * listened yet. That shape exists so a test can drive the whole API with
 * `app.inject()` against an in-memory database — no port, no network, no fixture
 * server. A route that can only be exercised through a running process is a route
 * whose authorization is verified by hand, which means not at all.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { Db } from '@sq/db';
import type { ApiConfig } from './config.js';
import { resolveSession } from './lib/sessions.js';
import { registerHealth } from './routes/health.js';
import { registerAuth, SESSION_COOKIE } from './routes/auth.js';
import { registerQuotes } from './routes/quotes.js';
import { registerEvaluations } from './routes/evaluations.js';
import { registerPriceBooks } from './routes/priceBooks.js';
import { registerDocuments } from './routes/documents.js';
import { registerShares } from './routes/shares.js';
import { registerSend } from './routes/send.js';
import { registerBomExport } from './routes/bomExport.js';
import { registerPriceImport } from './routes/priceImport.js';
import { registerPriceOverrides } from './routes/priceOverrides.js';
import { registerQuoteFile } from './routes/quoteFile.js';
import { registerEnquiries } from './routes/enquiries.js';
import { registerPlaces } from './routes/places.js';
import { registerShedSafe } from './routes/shedsafe.js';
import { registerPlatform } from './routes/platform.js';
import { registerUsage } from './routes/usage.js';
import { registerSettings } from './routes/settings.js';
import { registerAdmin } from './routes/admin.js';

export interface AppDeps {
  db: Db;
  config: ApiConfig;
  /** Silences the request log in tests. */
  logger?: boolean;
}

/** Build the API. The caller owns the database and closes it. */
export async function buildApp({ db, config, logger = false }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    trustProxy: true,
    // A body limit, because an unbounded one is a memory exhaustion route. A shed
    // config with 40 options is a few kilobytes; 1 MB is generous.
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);

  await app.register(cors, {
    // Origins are an allow-list, never a wildcard: a wildcard with credentials is
    // ignored by browsers, and the workaround developers reach for is to drop
    // credentials — which is how a CSRF hole appears.
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  /**
   * Resolve the session for every request.
   *
   * A hook rather than per-route code, so a route cannot forget it. The session is
   * *optional* here — `/auth/sign-in` and `/health` have no session — and each route
   * asks for it explicitly through the guard. What the hook guarantees is that a
   * route which does ask is reading a session that was resolved the same way as
   * every other route.
   *
   * A `X-Tenant-Id` header is never trusted. If a request names a company, it must
   * be the session's company; the guard compares them and answers 404 on a mismatch.
   */
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (typeof token !== 'string' || token === '') return;

    const session = await resolveSession(db, config, token);
    if (session !== null) request.session = session;
  });

  // The API is mounted under a prefix so the three front-ends can proxy `/api/*`
  // without colliding with their own route names.
  await app.register(
    async (scope) => {
      registerHealth(scope, db);
      registerAuth(scope, db, config);
      registerQuotes(scope, db);
      registerEvaluations(scope, db);
      registerPriceBooks(scope, db);
      registerDocuments(scope, db);
      // A share link is minted for the **site's** origin, because that is where a customer opens it.
      // The client app is where the operator creates it, and the two are different hosts.
      registerSend(scope, db);
      registerBomExport(scope, db);
      registerPriceImport(scope, db);
      registerPriceOverrides(scope, db);
      registerQuoteFile(scope, db);
      registerEnquiries(scope, db);
      registerPlaces(scope);
      registerShedSafe(scope, db);
      registerPlatform(scope, db);
      registerUsage(scope, db);
      registerSettings(scope, db);
      registerShares(scope, db, process.env.SITE_ORIGIN ?? 'http://localhost:3063');
      registerAdmin(scope, db, config);
    },
    { prefix: '/api/v1' },
  );

  /**
   * One error handler, so an unhandled throw never returns a stack trace.
   *
   * The message is logged; the client gets a code and a sentence. A stack trace in a
   * response is an inventory of the system handed to whoever asked.
   */
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'unhandled');
    reply.status(500).send({
      ok: false,
      code: 'internal',
      message: 'Something went wrong. The details were logged.',
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    // The envelope shape is kept even for a 404, so a client parses one shape.
    reply.status(404).send({ ok: false, code: 'not_found', message: 'No such route.' });
  });

  return app;
}
