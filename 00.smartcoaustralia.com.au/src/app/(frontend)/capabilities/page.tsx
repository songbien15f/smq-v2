import type { Metadata } from 'next'

import type { CapabilitiesPage } from '@/payload-types'
import { getGlobal } from '@/lib/payload'
import { buildMetadata } from '@/lib/seo'
import { isListVisible, isSectionVisible } from '@/lib/visibility'

import { CapabilityGrid } from '@/components/sections/CapabilityGrid'
import { PageHero } from '@/components/ui/PageHero'

export async function generateMetadata(): Promise<Metadata> {
  const page = await getGlobal<CapabilitiesPage>('capabilities-page')

  return buildMetadata({
    title: page?.meta?.title || 'Capabilities',
    description:
      page?.meta?.description ||
      'Steel fabrication, structural design, Tekla shop drawings, workshop inspection, trial assembly and door-to-door logistics — one accountable partner from concept to site delivery.',
    path: '/capabilities',
  })
}

export default async function CapabilitiesPageView() {
  const page = await getGlobal<CapabilitiesPage>('capabilities-page')

  const showIntro = isSectionVisible(page.intro)
  const showList = isListVisible(page.capabilitiesVisible, page.capabilities)

  return (
    <main id="main">
      {isSectionVisible(page.hero) ? (
        <PageHero
          eyebrow={page.hero.eyebrow}
          title={page.hero.title}
          lede={page.hero.lede}
        />
      ) : null}
      {showIntro || showList ? (
        <CapabilityGrid
          intro={showIntro ? page.intro : null}
          capabilities={showList ? page.capabilities : []}
        />
      ) : null}
    </main>
  )
}
