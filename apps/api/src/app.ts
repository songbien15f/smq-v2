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
import type { TransactionalDeps } from './lib/mail/transactional.js';
import { registerHealth } from './routes/health.js';
import { registerAuth, SESSION_COOKIE } from './routes/auth.js';
import { registerQuotes } from './routes/quotes.js';
import { registerEvaluations } from './routes/evaluations.js';
import { registerPriceBooks } from './routes/priceBooks.js';
import { registerCatalogues } from './routes/catalogues.js';
import { registerDocuments } from './routes/documents.js';
import { registerShares } from './routes/shares.js';
import { registerSend } from './routes/send.js';
import { registerBomExport } from './routes/bomExport.js';
import { registerVquExport } from './routes/vquExport.js';
import { registerPriceImport } from './routes/priceImport.js';
import { registerPriceOverrides } from './routes/priceOverrides.js';
import { registerQuoteFile } from './routes/quoteFile.js';
import { registerEnquiries } from './routes/enquiries.js';
import { registerPlaces } from './routes/places.js';
import { registerShedSafe } from './routes/shedsafe.js';
import { registerPlatform } from './routes/platform.js';
import { registerTemplateFiles } from './routes/templateFiles.js';
import { registerUsage } from './routes/usage.js';
import { registerSettings } from './routes/settings.js';
import { registerAdmin } from './routes/admin.js';
import { registerVendor } from './routes/vendor.js';

export interface AppDeps {
  db: Db;
  config: ApiConfig;
  /** Silences the request log in tests. */
  logger?: boolean;
  /**
   * How to send mail that is not a quote — a reset link, an invitation.
   *
   * `null` means this server has no SMTP. The routes that need it answer 503 with a sentence
   * rather than accepting a request and quietly sending nothing.
   */
  mail?: TransactionalDeps | null;
}

/** Build the API. The caller owns the database and closes it. */
export async function buildApp({ db, config, logger = false, mail = null }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    trustProxy: true,
    // A body limit, because an unbounded one is a memory exhaustion route. A shed
    // config with 40 options is a few kilobytes; 1 MB is generous.
    bodyLimit: 1024 * 1024,
  });

  /**
   * One error handler, so an unhandled throw never returns a stack trace.
   *
   * The message is logged; the client gets a code and a sentence. A stack trace in a
   * response is an inventory of the system handed to whoever asked.
   *
   * ## Why this is registered **before** the route plugin
   *
   * Fastify resolves handlers per encapsulation context. A handler set on the root instance
   * *after* `register` has already created the child context is not inherited by it, so the routes
   * answered with Fastify's default shape — including the original error `message`, which is how a
   * raw `UNIQUE constraint failed: memberships.username` reached a browser. Registering first means
   * the child is created with the handler already inherited.
   */
  app.setErrorHandler((error, request, reply) => {
    /*
     * **A Fastify error that already carries a status keeps it.**
     *
     * Wrapping everything as 500 turned a 413 into "Something went wrong. The details were logged."
     * — measured: a 2 MB upload to the price import answered 500, because this handler ran
     * *after* Fastify's body-limit parser had already decided the answer was 413. The operator was
     * told the server broke when in fact their file was too big, which is the one thing they can
     * act on.
     *
     * Only the status code is trusted, never the message: a parser error's message is about an
     * internal limit, and a database error's message is how a raw `UNIQUE constraint failed:
     * memberships.username` reached a browser once. The status is safe to pass on; the text is not.
     */
    // Fastify hands this handler an `unknown`; the two fields read below are its own contract on a
    // parsed request error, so they are narrowed once here rather than asserted at each use.
    const failure = error as { statusCode?: unknown; code?: unknown };
    const status = typeof failure.statusCode === 'number' ? failure.statusCode : 500;
    if (status >= 400 && status < 500) {
      request.log.warn({ err: error }, 'client error');
      const tooLarge = failure.code === 'FST_ERR_CTP_BODY_TOO_LARGE';
      reply.status(status).send({
        ok: false,
        code: tooLarge ? 'payload_too_large' : 'invalid_request',
        message: tooLarge
          ? 'That request body is larger than this endpoint accepts.'
          : 'That request could not be read.',
      });
      return;
    }

    request.log.error({ err: error }, 'unhandled');
    reply.status(500).send({
      ok: false,
      code: 'internal',
      message: 'Something went wrong. The details were logged.',
    });
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
      registerAuth(scope, db, config, mail);
      registerQuotes(scope, db);
      registerEvaluations(scope, db);
      registerPriceBooks(scope, db);
      registerCatalogues(scope, db);
      registerDocuments(scope, db);
      // A share link is minted for the **site's** origin, because that is where a customer opens it.
      // The client app is where the operator creates it, and the two are different hosts.
      registerSend(scope, db);
      registerBomExport(scope, db);
      registerVquExport(scope, db);
      registerPriceImport(scope, db);
      registerPriceOverrides(scope, db);
      registerQuoteFile(scope, db);
      /*
       * Enquiries take `mail` because an enquiry is a lead that must reach somebody. The copy the
       * route sends is not the record — the row is — but "somebody answered it" only happens if
       * somebody sees it, and until now nothing did.
       */
      registerEnquiries(scope, db, mail);
      registerPlaces(scope);
      registerShedSafe(scope, db);
      registerPlatform(scope, db);
      registerTemplateFiles(scope, db);
      registerUsage(scope, db);
      registerSettings(scope, db, mail);
      registerShares(scope, db, process.env.SITE_ORIGIN ?? 'http://localhost:3063');
      registerAdmin(scope, db, config);
      /*
       * The vendor dashboard. No session: it is the operator's own page behind one password, and he
       * may not be a member of any company. See `routes/vendor.ts` for why it is not `/admin/usage`.
       */
      registerVendor(scope, db);
    },
    { prefix: '/api/v1' },
  );

  app.setNotFoundHandler((_request, reply) => {
    // The envelope shape is kept even for a 404, so a client parses one shape.
    reply.status(404).send({ ok: false, code: 'not_found', message: 'No such route.' });
  });

  return app;
}
