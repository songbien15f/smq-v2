import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ProjectDetail, type ProjectSibling } from '@/components/sections/ProjectDetail'
import { PageHero } from '@/components/ui/PageHero'
import { getProjectBySlug, getProjects } from '@/lib/data'
import { PROJECTS_PAGE_LABEL, sectorLabel } from '@/lib/labels'
import { getGlobal } from '@/lib/payload'
import { buildMetadata } from '@/lib/seo'
import type { Project, ProjectDetailSetting } from '@/payload-types'

/** The middle crumb for a project: Home / Projects / <project title>. */
const PROJECTS_PARENT = { label: PROJECTS_PAGE_LABEL, href: '/projects' } as const

const sibling = (project: Project): ProjectSibling => ({
  slug: project.slug,
  title: project.title,
  location: project.location,
})

/**
 * The previous/next projects in the template's order, wrapping at both ends.
 *
 * `getProjects()` is already sorted by the project `order` field, so the list
 * index is the template's ORDER. A project absent from the list (a published
 * document read by slug but filtered out of the list) gets no neighbours.
 */
function findSiblings(
  projects: Project[],
  slug: string,
): { prev: ProjectSibling | null; next: ProjectSibling | null } {
  const index = projects.findIndex((project) => project.slug === slug)
  if (index === -1) return { prev: null, next: null }

  const count = projects.length
  if (count < 2) return { prev: null, next: null }

  return {
    prev: sibling(projects[(index + count - 1) % count]),
    next: sibling(projects[(index + 1) % count]),
  }
}

type ProjectDetailPageProps = {
  params: Promise<{ slug: string }>
}

/**
 * Prerender the published projects at build time.
 *
 * The build must not depend on a live database: the Docker image is built in a
 * stage that has no database, and a fresh clone may build before `npm run
 * migrate`. When the database is unreachable every project page is simply
 * rendered on demand (`dynamicParams` defaults to true) instead of failing the
 * build.
 */
export async function generateStaticParams() {
  try {
    const projects = await getProjects()
    return projects.map((project) => ({ slug: project.slug }))
  } catch (error) {
    console.warn('[projects] could not read projects during build; routes will render on demand:', error)
    return []
  }
}

export async function generateMetadata({ params }: ProjectDetailPageProps): Promise<Metadata> {
  const { slug } = await params
  const project = await getProjectBySlug(slug)

  if (!project) {
    return { title: 'Project not found' }
  }

  return buildMetadata({
    title: project.meta?.title || project.title,
    description: project.meta?.description || project.intro || undefined,
    path: `/projects/${project.slug}`,
  })
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { slug } = await params
  const [project, settings, projects] = await Promise.all([
    getProjectBySlug(slug),
    getGlobal<ProjectDetailSetting>('project-detail-settings'),
    getProjects(),
  ])

  if (!project) notFound()

  const { prev, next } = findSiblings(projects, project.slug)

  return (
    <main id="main">
      <PageHero
        eyebrow={project.title}
        parent={PROJECTS_PARENT}
        title={project.title}
        lede={project.intro}
        afterLede={
          <>
            <span className="chip">
              <strong>Location</strong> {project.location}
            </span>
            {project.sector ? (
              <span className="chip">
                <strong>Sector</strong> {sectorLabel(project.sector)}
              </span>
            ) : null}
            {project.structure ? (
              <span className="chip">
                <strong>Structure</strong> {project.structure}
              </span>
            ) : null}
          </>
        }
      />

      <ProjectDetail project={project} settings={settings} prev={prev} next={next} />
    </main>
  )
}
