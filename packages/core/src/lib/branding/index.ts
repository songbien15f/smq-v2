/**
 * The branding layer: the platform's own mark.
 *
 * Its own entry in the package so a browser bundle that wants the logo does not pull in
 * `node:fs` through the document renderer — the same reason `quoteFile` is separate.
 */

export { loadLogo, logoDataUri, sniffImageMime, MAX_LOGO_BYTES } from './logo.js';
export type { LogoImage } from './logo.js';
