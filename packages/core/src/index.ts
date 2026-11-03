/**
 * `@sq/core` — the business core, and the only place a shed's numbers are
 * computed.
 *
 * **The boundary that matters:** nothing under here imports a database, an HTTP
 * client, a session, or a tenant. A config and a price lookup go in; a bill of
 * materials and a price come out. That is why the engine can be tested without
 * infrastructure, and why three different front-ends can share it.
 *
 * Prefer the subpath entry points over this barrel in a browser bundle:
 * `@sq/core/domain` and `@sq/core/bom` carry no server-only code, while
 * `@sq/core/pricing` and `@sq/core/documents` touch `node:sqlite`, `node:fs` and
 * ExcelJS and must stay on the server.
 */

export * from './domain/index.js';
export * from './lib/bom/index.js';
export * from './lib/pricing/index.js';
export * from './lib/estimating/index.js';
export * from './lib/documents/index.js';
