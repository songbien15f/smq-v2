import type { Metadata } from 'next'

import type { Office, SiteSetting } from '../payload-types'
import { mediaUrl } from './media'

/**
 * One place for the site's canonical origin and for turning page copy into
 * Next metadata.
 *
 * `NEXT_PUBLIC_SERVER_URL` is the single source of truth for absolute URLs:
 * canonicals, OpenGraph URLs, the sitemap, robots and JSON-LD all derive from
 * it, so a deploy only has to set that one variable. The fallback exists for a
 * production build that forgot to set it — it keeps the build green rather than
 * emitting relative URLs that search engines ignore.
 */
export const SITE_NAME = 'Smart Solutions Australia'

export const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3065').replace(
  /\/+$/,
  '',
)

export const metadataBase = new URL(serverUrl)

/** An absolute URL for a site path, e.g. `/projects` → `https://example.com/projects`. */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${serverUrl}${path.startsWith('/') ? path : `/${path}`}`
}

export type MetadataInput = {
  title: string
  description?: string | null
  path: string
  image?: string | null
}

/**
 * Build the metadata for one page.
 *
 * The title is plain text: the frontend layout owns the
 * `%s | Smart Solutions Australia` template, so no page repeats the site name.
 */
export function buildMetadata({ title, description, path, image }: MetadataInput): Metadata {
  const url = absoluteUrl(path)
  const descriptionValue = description?.trim() || undefined
  const imageUrl = image?.trim() || undefined

  return {
    title,
    description: descriptionValue,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title,
      description: descriptionValue,
      url,
      images: imageUrl ? [{ url: imageUrl }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: descriptionValue,
      images: imageUrl ? [imageUrl] : undefined,
    },
  }
}

/**
 * Structured data for the home page.
 *
 * One `Organization` for the business itself, plus a `LocalBusiness` for each of
 * the two places a client can actually visit (Sydney and Ho Chi Minh City).
 * Western Australia is deliberately absent: it is an enquiry line serviced from
 * Sydney, not an office with an address and hours.
 */

export type JsonLdNode = Record<string, unknown>

const DAY_CODES: Record<string, string> = {
  monday: 'Mo',
  tuesday: 'Tu',
  wednesday: 'We',
  thursday: 'Th',
  friday: 'Fr',
  saturday: 'Sa',
  sunday: 'Su',
}

const clock = (hour: string, minute: string | undefined, meridiem: string): string => {
  let h = Number(hour) % 12
  if (meridiem.toLowerCase() === 'pm') h += 12
  return `${String(h).padStart(2, '0')}:${minute ?? '00'}`
}

const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)`
const DAY = String.raw`([a-z]+)`
const RANGE = new RegExp(
  String.raw`^${DAY}\s*[–—-]\s*${DAY}\s+${TIME}\s*[–—-]\s*${TIME}$`,
  'i',
)
const SINGLE = new RegExp(String.raw`^${DAY}\s+${TIME}\s*[–—-]\s*${TIME}$`, 'i')

/**
 * Turn an office's human hours ("Monday – Friday 8:30 am – 5:30 pm") into the
 * schema.org opening-hours syntax ("Mo-Fr 08:30-17:30").
 *
 * Anything that does not parse — "By appointment", a holiday note — is kept as
 * the written text rather than dropped, so the structured data never claims
 * hours the page does not show. Closed days are omitted.
 */
export function officeOpeningHours(
  hours: { label: string; value: string }[] | null | undefined,
): string[] {
  const entries: string[] = []

  for (const { label, value } of hours ?? []) {
    const text = value.trim()
    if (!text || /^closed$/i.test(text)) continue

    const range = text.match(RANGE)
    if (range) {
      const [, fromDay, toDay, h1, m1, p1, h2, m2, p2] = range
      const from = DAY_CODES[fromDay.toLowerCase()]
      const to = DAY_CODES[toDay.toLowerCase()]
      if (from && to) {
        entries.push(`${from}-${to} ${clock(h1, m1, p1)}-${clock(h2, m2, p2)}`)
        continue
      }
    }

    const single = text.match(SINGLE)
    if (single) {
      const [, day, h1, m1, p1, h2, m2, p2] = single
      const code = DAY_CODES[day.toLowerCase()]
      if (code) {
        entries.push(`${code} ${clock(h1, m1, p1)}-${clock(h2, m2, p2)}`)
        continue
      }
    }

    entries.push(`${label}: ${text}`)
  }

  return entries
}

const postalAddress = (office: Office): JsonLdNode => {
  const lines = (office.addressLines ?? []).map((line) => line.trim()).filter(Boolean)
  const streetLines = lines.length > 1 ? lines.slice(0, -1) : lines
  const locality = lines.length > 1 ? lines[lines.length - 1] : office.name

  return {
    '@type': 'PostalAddress',
    streetAddress: streetLines.join(', ') || undefined,
    addressLocality: locality,
    addressCountry: office.countryCode,
  }
}

/** The offices that are places a client can visit, in structured-data order. */
const BUSINESS_OFFICES: { key: 'sydney' | 'hcmc'; match: RegExp }[] = [
  { key: 'sydney', match: /^sydney$/i },
  { key: 'hcmc', match: /^ho chi minh( city)?$/i },
]

export function organizationJsonLd(settings: SiteSetting | null, offices: Office[]): JsonLdNode {
  const siteName = settings?.brand?.siteName || SITE_NAME
  const email = settings?.contact?.email || undefined
  const telephone = settings?.contact?.phoneAU || undefined
  const logo = mediaUrl(settings?.brand?.logo)

  const organization: JsonLdNode = {
    '@type': 'Organization',
    '@id': `${serverUrl}/#organization`,
    name: siteName,
    url: serverUrl,
    logo: logo ? absoluteUrl(logo) : undefined,
    email,
    telephone,
  }

  const locations = BUSINESS_OFFICES.flatMap(({ match }) => {
    const office = offices.find((candidate) => match.test(candidate.name.trim()))
    if (!office) return []

    const openingHours = officeOpeningHours(office.hours)

    return [
      {
        '@type': 'LocalBusiness',
        '@id': `${serverUrl}/#${office.name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
        name: `${siteName} — ${office.name}`,
        parentOrganization: { '@id': organization['@id'] },
        address: postalAddress(office),
        telephone: office.phone || telephone,
        email: office.email || email,
        openingHours: openingHours.length ? openingHours : undefined,
      } satisfies JsonLdNode,
    ]
  })

  return {
    '@context': 'https://schema.org',
    '@graph': [organization, ...locations],
  }
}
