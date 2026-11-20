import type { Metadata } from 'next'
import Link from 'next/link'

import type { TeamPage } from '@/payload-types'
import { getTeamMembers } from '@/lib/data'
import { mediaUrl } from '@/lib/media'
import { getGlobal } from '@/lib/payload'
import { buildMetadata } from '@/lib/seo'
import { isSectionVisible } from '@/lib/visibility'

import { TeamGrid } from '@/components/sections/TeamGrid'
import { PageHero } from '@/components/ui/PageHero'
import { Reveal } from '@/components/ui/Reveal'
import { SafeImage } from '@/components/ui/SafeImage'
import { SectionHead } from '@/components/ui/SectionHead'
import { resolveHref } from '@/lib/quote'

export async function generateMetadata(): Promise<Metadata> {
  const page = await getGlobal<TeamPage>('team-page')

  return buildMetadata({
    title: page?.meta?.title || 'Our Team',
    description:
      page?.meta?.description ||
      'The people behind your steel — leadership in Sydney, project management and inspection on the ground in Vietnam, and design & compliance backed by 2,000+ delivered projects.',
    path: '/team',
  })
}

export default async function TeamPageView() {
  const [page, members] = await Promise.all([
    getGlobal<TeamPage>('team-page'),
    getTeamMembers(),
  ])

  const quoteImage = page.quote.image && typeof page.quote.image === 'object' ? page.quote.image : null
  const quoteImageAlt = page.quote.imageAlt || quoteImage?.alt || page.quote.text

  const showIntro = isSectionVisible(page.intro)
  const showQuote = isSectionVisible(page.quote)

  return (
    <main id="main">
      {isSectionVisible(page.hero) ? (
        <PageHero eyebrow={page.hero.eyebrow} title={page.hero.title} lede={page.hero.lede}>
          <Link className="btn btn-accent" href={resolveHref(page.hero.primaryHref)}>
            {page.hero.primaryLabel}
          </Link>
        </PageHero>
      ) : null}

      <section id="team" aria-labelledby="team-h">
        <div className="wrap">
          {showIntro ? (
            <SectionHead
              eyebrow={page.intro.eyebrow}
              title={page.intro.title}
              body={page.intro.body}
              id="team-h"
              reveal
            />
          ) : null}

          <TeamGrid members={members} />

          {showQuote ? (
            <Reveal as="figure" className="team-wide">
              <SafeImage
                src={mediaUrl(page.quote.image)}
                alt={quoteImageAlt}
                width={quoteImage?.width ?? 1800}
                height={quoteImage?.height ?? 686}
                sizes="(max-width: 1240px) 100vw, 1200px"
              />
              <figcaption>
                {page.quote.text}
                {page.quote.attribution ? (
                  <span className="team-quote-attr"> — {page.quote.attribution}</span>
                ) : null}
              </figcaption>
            </Reveal>
          ) : null}
        </div>
      </section>
    </main>
  )
}
