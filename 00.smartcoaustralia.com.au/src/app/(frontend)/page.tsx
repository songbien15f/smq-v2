import type { Metadata } from 'next'

import type { HomePage } from '@/payload-types'
import { getProjects } from '@/lib/data'
import { pickFeatured } from '@/lib/filterProjects'
import { getGlobal } from '@/lib/payload'
import { buildMetadata } from '@/lib/seo'
import { isListVisible, isSectionVisible } from '@/lib/visibility'

import { CertificationStrip } from '@/components/sections/CertificationStrip'
import { ExploreCards } from '@/components/sections/ExploreCards'
import { FeaturedProject } from '@/components/sections/FeaturedProject'
import { HeroHome } from '@/components/sections/HeroHome'
import { OfficeSplit } from '@/components/sections/OfficeSplit'

export async function generateMetadata(): Promise<Metadata> {
  const home = await getGlobal<HomePage>('home-page')

  return buildMetadata({
    title: home?.meta?.title || 'Structural Steel Fabricated in Vietnam',
    description:
      home?.meta?.description ||
      'Smart Solutions Australia pairs two decades on the ground in Vietnam with Australian engineering, inspection and project management — offshore fabrication economics without the offshore risk.',
    path: '/',
  })
}

export default async function HomePageView() {
  const [home, projects] = await Promise.all([
    getGlobal<HomePage>('home-page'),
    getProjects(),
  ])

  const featured = pickFeatured(projects)

  return (
    <main id="main">
      {isSectionVisible(home.hero) ? <HeroHome hero={home.hero} stats={home.stats} /> : null}
      {isListVisible(home.certificationsVisible, home.certifications) ? (
        <CertificationStrip label={home.certificationsLabel} certifications={home.certifications} />
      ) : null}
      {isSectionVisible(home.officeSplit) ? <OfficeSplit officeSplit={home.officeSplit} /> : null}
      {isListVisible(home.exploreCardsVisible, home.exploreCards) ? (
        <ExploreCards intro={home.exploreIntro} cards={home.exploreCards}>
          <FeaturedProject
            project={featured}
            eyebrow={home.featuredSection?.eyebrow}
            ctaLabel={home.featuredSection?.ctaLabel}
          />
        </ExploreCards>
      ) : null}
    </main>
  )
}
