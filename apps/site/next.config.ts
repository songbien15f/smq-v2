import type { NextConfig } from 'next';

/**
 * Security headers for the public site.
 *
 * The site is the end-customer surface: a landing page, the share viewer and the enquiry form. Two
 * differences from the other apps:
 *
 * 1. **`Referrer-Policy: no-referrer`.** A share link is `…/s#<token>` and the token is in the
 *    fragment precisely so it never reaches a server. A `Referer` header carrying the path of a shared
 *    quote would leak which customer was looking at what to any third party the page loads, so this app
 *    sends none at all.
 * 2. **The document iframe still works.** `frame-ancestors 'none'` blocks *other* sites embedding
 *    us; it does not stop this app from embedding the API's `/share/document`, which is a normal
 *    outbound frame.
 *
 * **No `script-src` yet** — same reason as the other two apps: Next injects inline scripts, and a
 * policy without a nonce is either broken or `'unsafe-inline'`.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
  // The one deliberate difference: a share token lives in the URL fragment, and no `Referer` should
  // ever carry a customer's path to a third party.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  /*
   * `@sq/core` is here for the Guest page (`/quote`, plan G-a P6) and only its **domain** subpath may
   * be imported: `@sq/core/domain`. Pricing, BOM and estimating never reach this app — the Guest page
   * shows no price anywhere, including in its bundle (D-T3).
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
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
