import type { MetadataRoute } from 'next'

import { getProjects } from '@/lib/data'
import { absoluteUrl } from '@/lib/seo'

/**
 * Every public page, plus one entry per published project.
 *
 * The static list is the site's fixed route table; projects come from Payload so
 * a newly published project appears without a code change. `lastModified` is the
 * record's own `updatedAt` for project pages (the only pages with a real edit
 * timestamp), and the build time for the code-owned static pages.
 */
const STATIC_ROUTES = [
  '/',
  '/capabilities',
  '/process',
  '/quality',
  '/projects',
  '/products',
  '/team',
  '/contact',
  '/privacy',
] as const

/** Priorities follow the page tree: the landing page and the key funnels first. */
const PRIORITY: Record<string, number> = {
  '/': 1,
  '/projects': 0.9,
  '/capabilities': 0.8,
  '/contact': 0.8,
  '/process': 0.7,
  '/quality': 0.7,
  '/products': 0.7,
  '/team': 0.6,
  '/privacy': 0.3,
}

// Pages render per request (see the frontend layout), so a project published in
// the admin should reach the sitemap without a redeploy. One query per crawler
// hit is a fair price for that.
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticEntries = STATIC_ROUTES.map((path) => ({
    url: absoluteUrl(path),
    lastModified: now,
    changeFrequency: (path === '/' ? 'weekly' : 'monthly') as 'weekly' | 'monthly',
    priority: PRIORITY[path] ?? 0.5,
  }))

  const projects = await getProjects()
  const projectEntries = projects.map((project) => ({
    url: absoluteUrl(`/projects/${project.slug}`),
    lastModified: new Date(project.updatedAt),
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }))

  return [...staticEntries, ...projectEntries]
}
