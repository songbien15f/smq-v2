import type { Metadata } from 'next'
import { RichText } from '@payloadcms/richtext-lexical/react'
import type { JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

import type { PrivacyPage } from '@/payload-types'
import { getGlobal } from '@/lib/payload'
import { formatPolicyDate, lexicalNodeText, policySectionId } from '@/lib/privacy'
import { buildMetadata } from '@/lib/seo'
import { isSectionVisible } from '@/lib/visibility'

import { PageHero } from '@/components/ui/PageHero'

const FALLBACK_DESCRIPTION =
  'How Smart Solutions Australia collects, holds, uses, discloses and protects personal information under the Privacy Act 1988 (Cth) and the Australian Privacy Principles.'

/**
 * Section headings become `h2` with a stable anchor id, so a complaint or a
 * consent link can point at a clause. Every other node renders exactly as the
 * shared Lexical renderer does elsewhere on the site — this is the same
 * `RichText` component the project and team pages use, with one converter
 * overridden rather than a second renderer.
 */
const policyConverters: JSXConvertersFunction = ({ defaultConverters }) => ({
  ...defaultConverters,
  heading: ({ node, nodesToJSX }) => {
    const children = nodesToJSX({ nodes: node.children })

    if (node.tag !== 'h2') {
      const Tag = node.tag
      return <Tag>{children}</Tag>
    }

    return <h2 id={policySectionId(lexicalNodeText(node))}>{children}</h2>
  },
})

export async function generateMetadata(): Promise<Metadata> {
  const page = await getGlobal<PrivacyPage>('privacy-page')

  return buildMetadata({
    title: page?.meta?.title || 'Privacy Policy',
    description: page?.meta?.description || FALLBACK_DESCRIPTION,
    path: '/privacy',
  })
}

export default async function PrivacyPageView() {
  const page = await getGlobal<PrivacyPage>('privacy-page')
  const body = page?.body as SerializedEditorState | null | undefined
  const lastUpdated = formatPolicyDate(page?.lastUpdated)

  return (
    <main id="main">
      {isSectionVisible(page?.hero) ? (
        <PageHero eyebrow={page.hero.eyebrow} title={page.hero.title} />
      ) : null}

      {body?.root ? (
        <section className="policy" aria-label="Privacy policy">
          <div className="wrap">
            {lastUpdated ? (
              <p className="policy-updated">
                Last updated:{' '}
                <time dateTime={page?.lastUpdated?.slice(0, 10)}>{lastUpdated}</time>
              </p>
            ) : null}

            <div className="policy-prose">
              <RichText data={body} converters={policyConverters} disableContainer />
            </div>
          </div>
        </section>
      ) : null}
    </main>
  )
}
