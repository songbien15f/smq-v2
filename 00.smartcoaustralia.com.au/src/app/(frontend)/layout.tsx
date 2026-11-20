import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { JsonLd } from '@/components/seo/JsonLd'
import { getOffices } from '@/lib/data'
import { getGlobal } from '@/lib/payload'
import { SITE_NAME, metadataBase } from '@/lib/seo'
import type { SiteSetting } from '@/payload-types'

import './styles.css'

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
}

// Global copy lives in Payload; render per request so admin edits appear without a rebuild.
export const dynamic = 'force-dynamic'

export default async function FrontendLayout({ children }: { children: ReactNode }) {
  // The header and footer already read these globals; `getGlobal` and
  // `getOffices` are request-cached, so the JSON-LD adds no extra queries.
  const [settings, offices] = await Promise.all([
    getGlobal<SiteSetting>('site-settings'),
    getOffices(),
  ])

  return (
    <html lang="en-AU">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <JsonLd settings={settings} offices={offices} />
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  )
}
