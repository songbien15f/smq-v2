import Image from 'next/image'
import Link from 'next/link'

import { MAIN_NAV, type NavKey } from '@/lib/constants'
import { getGlobal } from '@/lib/payload'
import type { Header, SiteSetting } from '@/payload-types'

import { HeaderScrollState } from './HeaderScrollState'
import { MobileNav } from './MobileNav'
import { NavLink } from './NavLink'
import { resolveHref } from '@/lib/quote'

const NAV_ID = 'main-nav'

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

/**
 * A phone string such as `+61 412 239 259` becomes the `tel:` target the
 * template uses: a leading `+` followed by the digits only.
 */
function telHref(phone: string): string {
  return `tel:+${phone.replace(/\D/g, '')}`
}

export async function SiteHeader() {
  const [header, settings] = await Promise.all([
    getGlobal<Header>('header'),
    getGlobal<SiteSetting>('site-settings'),
  ])

  const labels = header?.labels
  const items = MAIN_NAV.map((item) => ({
    key: item.key,
    href: item.href,
    label: labels?.[item.key] ?? FALLBACK_LABELS[item.key],
  }))

  const siteName = settings?.brand?.siteName ?? 'Smart Solutions Australia'
  const ctaLabel = header?.ctaLabel ?? 'Request a Quote'
  const ctaHref = resolveHref(header?.ctaHref ?? '/quote')

  // The strip's contact details reuse Site Settings; only the locations and the
  // on/off switch live on the Header global.
  const showTopStrip = header?.showTopStrip !== false
  const locations = (header?.topStripLocations ?? [])
    .map((row) => row?.label?.trim())
    .filter((label): label is string => Boolean(label))
  const phoneAU = settings?.contact?.phoneAU?.trim()
  const email = settings?.contact?.email?.trim()

  const logo = settings?.brand?.logo
  const logoDoc = logo && typeof logo === 'object' ? logo : null
  const logoUrl = logoDoc?.url
  const logoWidth = logoDoc?.width ?? 1280
  const logoHeight = logoDoc?.height ?? 360

  return (
    <>
      {showTopStrip ? (
        <div className="topstrip">
          <div className="wrap">
            {locations.map((label) => (
              <span key={label}>{label}</span>
            ))}
            <span className="spacer" aria-hidden="true" />
            {phoneAU ? <a href={telHref(phoneAU)}>{`AU ${phoneAU}`}</a> : null}
            {email ? <a href={`mailto:${email}`}>{email}</a> : null}
          </div>
        </div>
      ) : null}

      <header className="site-header" id="site-header">
        <div className="wrap header-in">
          <Link className="brand" href="/" aria-label={`${siteName} — home`}>
            {logoUrl ? (
              <Image
                className="brand-logo"
                src={logoUrl}
                alt={logoDoc?.alt || siteName}
                width={logoWidth}
                height={logoHeight}
                priority
              />
            ) : (
              <span className="brand-name">{siteName}</span>
            )}
          </Link>

          <MobileNav navId={NAV_ID} itemCount={items.length} />

          <nav id={NAV_ID} className="main-nav" aria-label="Main navigation">
            <ul>
              {items.map((item) => (
                <li key={item.key}>
                  <NavLink href={item.href} label={item.label} />
                </li>
              ))}
              {/* Mobile-only quote link, styled by the template's .nav-quote rule.
                  It intentionally has no data-nav/data-cta: the fixed nav stays at
                  eight links and the desktop header CTA remains the only data-cta. */}
              <li className="nav-quote">
                <Link className="nav-quote" href={ctaHref}>
                  {ctaLabel}
                </Link>
              </li>
            </ul>
          </nav>

          <Link className="btn btn-accent header-cta" data-cta="true" href={ctaHref}>
            {ctaLabel}
          </Link>
        </div>
        <HeaderScrollState />
      </header>
    </>
  )
}
