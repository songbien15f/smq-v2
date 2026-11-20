import type { Metadata } from 'next'
import Link from 'next/link'

import type { ProjectsPage } from '@/payload-types'
import { ProjectFilterBar } from '@/components/sections/ProjectFilterBar'
import { FeaturedProjectCard, ProjectGrid } from '@/components/sections/ProjectGrid'
import { PageHero } from '@/components/ui/PageHero'
import { SectionHead } from '@/components/ui/SectionHead'
import { getProjects } from '@/lib/data'
import { filterProjects, pickFeatured } from '@/lib/filterProjects'
import { SECTOR_FILTERS, STATE_FILTERS, resultsNote } from '@/lib/labels'
import { getGlobal } from '@/lib/payload'
import { buildMetadata } from '@/lib/seo'
import { isSectionVisible } from '@/lib/visibility'
import { resolveHref } from '@/lib/quote'

export async function generateMetadata(): Promise<Metadata> {
  const page = await getGlobal<ProjectsPage>('projects-page')

  return buildMetadata({
    title: page?.meta?.title || 'Projects',
    description:
      page?.meta?.description ||
      'Selected projects delivered by Smart Solutions Australia — fabricated in Vietnam, inspected under our QA system, and erected on sites across Australia.',
    path: '/projects',
  })
}

type ProjectsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/** Unknown filter values fall back to "all" so the controls always match the list. */
const knownValue = (value: string | undefined, allowed: readonly string[]) => {
  const trimmed = value?.trim() ?? ''
  return allowed.includes(trimmed) ? trimmed : ''
}

const SECTOR_VALUES = SECTOR_FILTERS.map((option) => option.value)
const STATE_VALUES = STATE_FILTERS.map((option) => option.value)

export default async function ProjectsPageView({ searchParams }: ProjectsPageProps) {
  const params = (await searchParams) ?? {}
  const sector = knownValue(first(params.sector), SECTOR_VALUES)
  const state = knownValue(first(params.state), STATE_VALUES)

  const [page, projects] = await Promise.all([
    getGlobal<ProjectsPage>('projects-page'),
    getProjects(),
  ])

  const visible = filterProjects(projects, { sector, state })
  const featured = pickFeatured(projects)

  return (
    <main id="main">
      {isSectionVisible(page.hero) ? (
        <PageHero
          eyebrow={page.hero.eyebrow}
          title={page.hero.title}
          lede={page.hero.lede}
        >
          <Link className="btn btn-accent" href={resolveHref(page.hero.primaryHref)}>
            {page.hero.primaryLabel}
          </Link>
          <Link className="btn btn-ghost" href={page.hero.secondaryHref}>
            {page.hero.secondaryLabel}
          </Link>
        </PageHero>
      ) : null}

      <section aria-labelledby="projects-h" style={{ paddingTop: 56 }}>
        <div className="wrap">
          {page.hero?.intro?.title ? (
            <SectionHead
              eyebrow={page.hero.intro.eyebrow}
              title={page.hero.intro.title}
              body={page.hero.intro.body}
              id="projects-h"
            />
          ) : null}

          <FeaturedProjectCard project={featured} />

          <ProjectFilterBar initialSector={sector} initialState={state} />
          <p className="results-note" role="status">
            {resultsNote(visible.length, projects.length)}
          </p>

          <ProjectGrid projects={visible} />

          {isSectionVisible(page.note) && page.note?.title ? (
            <div className="quality-note projects-note">
              <strong>{page.note.title}</strong> {page.note.body}
              {page.note.linkHref && page.note.linkLabel ? (
                <>
                  {' '}
                  <Link href={resolveHref(page.note.linkHref)}>{page.note.linkLabel}</Link>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}
