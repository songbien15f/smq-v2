import type { NextConfig } from 'next';

/**
 * Security headers for the quote editor and workspace.
 *
 * **No `script-src` yet.** Next injects inline scripts, so a script policy needs a per-request nonce
 * through middleware. Adding one without a nonce either breaks the app or gets weakened to
 * `'unsafe-inline'`, which is worse than not claiming to have a policy. Everything below is safe
 * without a nonce and closes the attack classes that need no script execution.
 *
 * The API is a different origin and deliberately does **not** get these headers: the site embeds
 * `${API}/share/document` in an iframe, so a `frame-ancestors 'none'` on the API would break the
 * customer's share page.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Ignored over plain HTTP, so a local `pnpm dev` is unaffected.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  /**
   * The workspace packages ship TypeScript source to Next, which compiles them alongside the
   * app. Without this, Next treats them as opaque dependencies and a change to a component needs
   * a package build before the dev server sees it.
   *
   * `@sq/core` is listed because the editor imports the building model directly. It must be the
   * **domain** subpath only: the pricing and documents entry points touch `node:sqlite` and
   * ExcelJS and must never reach a browser bundle.
   */
  transpilePackages: ['@sq/ui', '@sq/contracts', '@sq/core', '@sq/viewer3d'],

  /*
   * Cloudflare quick tunnels (scripts/tunnel.mjs) reach this dev server under a
   * `*.trycloudflare.com` host. Next blocks cross-origin requests to its own dev assets unless the
   * host is named, so a QA link would render a page with no JavaScript and no explanation. Only the
   * project's own tunnel domain is allowed: naming the whole of trycloudflare.com would let any other
   * tunnel load this app's dev assets.
   */
  allowedDevOrigins: ['*.trycloudflare.com'],
  experimental: {
    // A quote editor is a long-lived page; keeping the router state alive avoids a full reload
    // when moving between the list and the editor.
    staleTimes: { dynamic: 0, static: 30 },
  },
  // `X-Powered-By: Next.js` tells a scanner what to try. It costs nothing to stop saying it.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
