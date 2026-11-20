import type { Metadata } from 'next'

import type { QualityPage } from '@/payload-types'
import { mediaUrl } from '@/lib/media'
import { getGlobal } from '@/lib/payload'
import { buildMetadata } from '@/lib/seo'
import { isListVisible, isSectionVisible } from '@/lib/visibility'

import { QaList } from '@/components/sections/QaList'
import { PageHero } from '@/components/ui/PageHero'
import { Reveal } from '@/components/ui/Reveal'
import { SafeImage } from '@/components/ui/SafeImage'
import { SectionHead } from '@/components/ui/SectionHead'

export async function generateMetadata(): Promise<Metadata> {
  const page = await getGlobal<QualityPage>('quality-page')

  return buildMetadata({
    title: page?.meta?.title || 'Compliance & Quality',
    description:
      page?.meta?.description ||
      'Every shipment is backed by a complete, auditable QA pack — inspection plans, welding records, mill certificates and CC3 traceability.',
    path: '/quality',
  })
}

export default async function QualityPageView() {
  const page = await getGlobal<QualityPage>('quality-page')
  const image = page.image && typeof page.image === 'object' ? page.image : null

  const showPhoto = isSectionVisible(page.photoVisible)
  const showIntro = isSectionVisible(page.intro)
  const showQa = isListVisible(page.qaItemsVisible, page.qaItems)
  const showSystems = isSectionVisible(page.managementSystems)
  const hasRight = showIntro || showQa || showSystems

  return (
    <main id="main">
      {isSectionVisible(page.hero) ? (
        <PageHero eyebrow={page.hero.eyebrow} title={page.hero.title} lede={page.hero.lede} />
      ) : null}

      {showPhoto || hasRight ? (
        <section className="quality" id="quality" aria-labelledby="quality-h">
          <div className="wrap quality-grid">
            {showPhoto ? (
              <Reveal as="figure" className="quality-photo">
                <SafeImage
                  src={mediaUrl(page.image)}
                  alt={image?.alt || page.intro.title}
                  width={image?.width ?? 900}
                  height={image?.height ?? 1200}
                  sizes="(max-width: 900px) 100vw, 45vw"
                />
                {page.imageCaption ? <figcaption>{page.imageCaption}</figcaption> : null}
              </Reveal>
            ) : null}

            {hasRight ? (
              <Reveal>
                {showIntro ? (
                  <SectionHead
                    eyebrow={page.intro.eyebrow}
                    title={page.intro.title}
                    body={page.intro.body}
                    id="quality-h"
                  />
                ) : null}

                {showQa ? <QaList items={page.qaItems} /> : null}

                {showSystems && page.managementSystems?.body ? (
                  <div className="quality-note">
                    <strong>{page.managementSystems.title}</strong> {page.managementSystems.body}
                  </div>
                ) : null}
              </Reveal>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  )
}
