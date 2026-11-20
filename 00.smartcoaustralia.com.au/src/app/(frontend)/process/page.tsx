import type { Metadata } from 'next'
import Link from 'next/link'

import type { ProcessPage } from '@/payload-types'
import { getGlobal } from '@/lib/payload'
import { buildMetadata } from '@/lib/seo'
import { isListVisible, isSectionVisible } from '@/lib/visibility'

import { ProcessSteps } from '@/components/sections/ProcessSteps'
import { PageHero } from '@/components/ui/PageHero'
import { resolveHref } from '@/lib/quote'

export async function generateMetadata(): Promise<Metadata> {
  const page = await getGlobal<ProcessPage>('process-page')

  return buildMetadata({
    title: page?.meta?.title || 'Our Process',
    description:
      page?.meta?.description ||
      'Offshore fabrication without the unknowns — five documented, inspected and reported steps carry your steel from first drawings to erection-ready delivery.',
    path: '/process',
  })
}

export default async function ProcessPageView() {
  const page = await getGlobal<ProcessPage>('process-page')

  const showCta = isSectionVisible(page.cta)
  const showIntro = isSectionVisible(page.intro)
  const showSteps = isListVisible(page.stepsVisible, page.steps)

  return (
    <main id="main">
      {isSectionVisible(page.hero) ? (
        <PageHero eyebrow={page.hero.eyebrow} title={page.hero.title} lede={page.hero.lede}>
          {showCta ? (
            <>
              <Link className="btn btn-accent" href={resolveHref(page.cta.primaryHref)}>
                {page.cta.primaryLabel}
              </Link>
              <Link className="btn btn-ghost" href={resolveHref(page.cta.secondaryHref)}>
                {page.cta.secondaryLabel}
              </Link>
            </>
          ) : null}
        </PageHero>
      ) : null}
      {showIntro || showSteps ? (
        <ProcessSteps
          intro={showIntro ? page.intro : null}
          steps={showSteps ? page.steps : []}
        />
      ) : null}
    </main>
  )
}
