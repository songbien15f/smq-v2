import Image from 'next/image'
import Link from 'next/link'

import { MAIN_NAV, type NavKey } from '@/lib/constants'
import { getGlobal } from '@/lib/payload'
import type { Footer, Header, SiteSetting } from '@/payload-types'
import { resolveHref } from '@/lib/quote'

const FALLBACK_LABELS: Record<NavKey, string> = {
  home: 'Home',
  capabilities: 'Capabilities',
  process: 'Process',
  quality: 'Quality',
  projects: 'Projects',
  products: 'Products',
  team: 'Team',
  contact: 'Contact',
}

export async function SiteFooter() {
  const [footer, header, settings] = await Promise.all([
    getGlobal<Footer>('footer'),
    getGlobal<Header>('header'),
    getGlobal<SiteSetting>('site-settings'),
  ])

  const labels = header?.labels
  const exploreItems = MAIN_NAV.filter((item) => item.key !== 'home').map((item) => ({
    key: item.key,
    href: item.href,
    label: labels?.[item.key] ?? FALLBACK_LABELS[item.key],
  }))

  const siteName = settings?.brand?.siteName ?? 'Smart Solutions Australia'
  const ctaLabel = header?.ctaLabel ?? 'Request a Quote'
  const ctaHref = resolveHref(header?.ctaHref ?? '/quote')
  const compliance = footer?.compliance ?? []

  const logo = settings?.brand?.logo
  const logoDoc = logo && typeof logo === 'object' ? logo : null
  const logoUrl = logoDoc?.url
  const logoWidth = logoDoc?.width ?? 1280
  const logoHeight = logoDoc?.height ?? 360

  return (
    <footer>
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link className="brand" href="/" aria-label={`${siteName} — back to top`}>
              {logoUrl ? (
                <Image
                  className="brand-logo footer-logo"
                  src={logoUrl}
                  alt={logoDoc?.alt || siteName}
                  width={logoWidth}
                  height={logoHeight}
                />
              ) : (
                <span className="brand-name">{siteName}</span>
              )}
            </Link>
            {footer?.description ? <p>{footer.description}</p> : null}
          </div>

          <nav aria-label="Footer">
            <h3>Explore</h3>
            <ul>
              {exploreItems.map((item) => (
                <li key={item.key}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
              <li>
                <Link href={ctaHref}>{ctaLabel}</Link>
              </li>
            </ul>
          </nav>

          <div>
            <h3>Compliance</h3>
            <ul>
              {compliance.map((item, index) => (
                <li key={`${item.label}-${index}`}>
                  <Link href={item.href || '/quality'}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          {footer?.copyright ? <span>{footer.copyright}</span> : null}
          {footer?.modernSlaveryText ? <span>{footer.modernSlaveryText}</span> : null}
          <Link href="/privacy">Privacy policy</Link>
        </div>
      </div>
    </footer>
  )
}
