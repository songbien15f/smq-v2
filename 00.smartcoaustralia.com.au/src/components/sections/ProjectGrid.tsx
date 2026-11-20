import Link from 'next/link'

import type { Project } from '@/payload-types'
import { Reveal } from '@/components/ui/Reveal'
import { SafeImage } from '@/components/ui/SafeImage'
import {
  FEATURED_PROJECT_CTA,
  FEATURED_PROJECT_LABEL,
  VIEW_PROJECT_LABEL,
  sectorLabel,
} from '@/lib/labels'
import { mediaUrl } from '@/lib/media'

type ProjectGridProps = {
  projects: Project[]
}

type FeaturedProjectCardProps = {
  project: Project | null
}

const imageDoc = (project: Project) =>
  project.heroImage && typeof project.heroImage === 'object' ? project.heroImage : null

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The template's `.feat-project` card above the filters. It is derived from the
 * project flagged `featured` in the projects collection and always links to
 * that project's detail page.
 */
export function FeaturedProjectCard({ project }: FeaturedProjectCardProps) {
  if (!project) return null

  const image = imageDoc(project)

  return (
    <Reveal as="article" className="feat-project" testId="featured-project">
      <SafeImage
        src={mediaUrl(project.heroImage)}
        alt={image?.alt || project.title}
        width={image?.width ?? 1400}
        height={image?.height ?? 933}
        sizes="(max-width: 900px) 100vw, 55vw"
      />
      <div className="feat-body">
        <span className="feat-flag">{FEATURED_PROJECT_LABEL}</span>
        <h3>{project.title}</h3>
        <p className="project-loc">{project.location}</p>
        <p>{project.intro}</p>
        <div className="spec-chips">
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
          {project.state ? (
            <span className="chip">
              <strong>Delivery</strong> Door to door, VN → {project.state}
            </span>
          ) : null}
        </div>
        <Link className="btn btn-dark" href={`/projects/${project.slug}`}>
          {FEATURED_PROJECT_CTA}
        </Link>
      </div>
    </Reveal>
  )
}

/**
 * The template's `.project-grid`: one card per project, each linking to its
 * detail page. The list is already filtered by the page, server-side.
 */
export function ProjectGrid({ projects }: ProjectGridProps) {
  if (projects.length === 0) return null

  return (
    <div className="project-grid">
      {projects.map((project) => {
        const image = imageDoc(project)

        return (
          <Reveal as="article" key={project.id} className="project-card" testId="project-card">
            <SafeImage
              src={mediaUrl(project.heroImage)}
              alt={image?.alt || project.title}
              width={image?.width ?? 1400}
              height={image?.height ?? 875}
              sizes="(max-width: 620px) 100vw, (max-width: 980px) 50vw, 33vw"
            />
            <div className="project-body">
              <span className="project-loc">{project.location}</span>
              <h3>{project.title}</h3>
              {project.cardSummary || project.intro ? (
                <p>{project.cardSummary || project.intro}</p>
              ) : null}
              <div className="project-meta">
                {project.sector ? <span>{sectorLabel(project.sector)}</span> : null}
                {project.structure ? <span>{project.structure}</span> : null}
                {project.cardTag ? <span>{project.cardTag}</span> : null}
              </div>
              <Link className="card-link" href={`/projects/${project.slug}`}>
                {VIEW_PROJECT_LABEL} <ArrowIcon />
              </Link>
            </div>
          </Reveal>
        )
      })}
    </div>
  )
}
