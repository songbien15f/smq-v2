import type { NextConfig } from 'next';

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
  transpilePackages: ['@sq/ui', '@sq/contracts', '@sq/core'],
  experimental: {
    // A quote editor is a long-lived page; keeping the router state alive avoids a full reload
    // when moving between the list and the editor.
    staleTimes: { dynamic: 0, static: 30 },
  },
};

export default nextConfig;
