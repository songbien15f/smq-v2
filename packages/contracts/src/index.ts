/**
 * `@sq/contracts` — every shape that crosses the wire between the API and a
 * front-end.
 *
 * One file per area, one source of truth. The reason this is a package rather than
 * a folder inside the API: three front-ends and the server all need to agree on
 * what a quote is, and the alternative — three hand-written copies — is how a
 * client ends up reading a field the server stopped sending.
 */

export * from './roles.js';
export * from './envelope.js';
export * from './auth.js';
export * from './quote.js';
export * from './evaluation.js';
export * from './admin.js';
