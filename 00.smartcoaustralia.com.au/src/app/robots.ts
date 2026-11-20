import type { MetadataRoute } from 'next'

import { serverUrl } from '@/lib/seo'

/**
 * The public site is fully indexable; the Payload admin, its API and Next's
 * internal asset routes are not. `/api` also covers `/api/health`, which is for
 * uptime checks rather than search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api', '/next'],
    },
    sitemap: `${serverUrl}/sitemap.xml`,
  }
}
