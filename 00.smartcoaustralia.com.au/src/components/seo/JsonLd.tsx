import type { Office, SiteSetting } from '@/payload-types'
import { organizationJsonLd } from '@/lib/seo'

/**
 * Structured data for the public site.
 *
 * A server component on purpose: the JSON-LD must be in the HTML a crawler
 * receives, so nothing here waits for hydration. Payload's rich-text editor can
 * legitimately produce `</script>` inside copy, so the serialised JSON is
 * escaped for a script context before it is written out.
 */
function serialize(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

type JsonLdProps = {
  settings: SiteSetting | null
  offices: Office[]
}

export function JsonLd({ settings, offices }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      // The payload is built from Payload content, not user markup, and is
      // escaped above; this is the one place inline script content is intended.
      dangerouslySetInnerHTML={{ __html: serialize(organizationJsonLd(settings, offices)) }}
    />
  )
}
