import type { NextConfig } from 'next';

/**
 * Security headers for the admin app.
 *
 * A vendor control plane that lists every company is the last place that should be framable or
 * sniffable, so the policy is the strict end of what a Next app can take without a nonce.
 *
 * **No `script-src` yet.** Next injects inline scripts, so a script policy needs a per-request nonce
 * through middleware. Adding a `script-src` without one either breaks the app or gets weakened to
 * `'unsafe-inline'`, which is worse than not claiming to have a policy. Everything below is safe
 * without a nonce and stops the classes of attack that need no script execution.
 *
 * Copied into each app rather than shared: three `next.config.ts` files, one line of divergence (the
 * site's referrer policy), and a shared package for this would be a fourth workspace dependency for
 * ten lines of constant data.
 */
const securityHeaders = [
  // Never let a browser guess a content type: a JSON answer sniffed as HTML is a script host.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Not framable at all. `frame-ancestors` below is the modern spelling; this is for old browsers.
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Content-Security-Policy',
    // `frame-ancestors` blocks embedding (clickjacking). The rest closes doors this app never needs:
    // no plugin content, no `<base>` hijack, and forms may only post back to us.
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
  // Send the origin to other sites; the full path only within this one.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Ignored over plain HTTP, so a local `pnpm dev` is unaffected.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // No feature of this app needs a camera, a microphone or a location.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // `@sq/core` for the building-type checks the form runs as it is typed. Only the `domain`
  // subpath is imported: `@sq/core/pricing` reaches for `node:fs` and must never reach a browser.
  transpilePackages: ['@sq/ui', '@sq/contracts', '@sq/core'],

  /*
   * Cloudflare quick tunnels (scripts/tunnel.mjs) reach this dev server under a
   * `*.trycloudflare.com` host. Next blocks cross-origin requests to its own dev assets unless the
   * host is named, so a QA link would render a page with no JavaScript and no explanation. Only the
   * project's own tunnel domain is allowed: naming the whole of trycloudflare.com would let any other
   * tunnel load this app's dev assets.
   */
  allowedDevOrigins: ['*.trycloudflare.com'],
  // `X-Powered-By: Next.js` tells a scanner what to try. It costs nothing to stop saying it.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
