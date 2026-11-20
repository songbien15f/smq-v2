import Link from 'next/link'

import type { Project } from '@/payload-types'
import { Reveal } from '@/components/ui/Reveal'
import { SafeImage } from '@/components/ui/SafeImage'
import { mediaUrl } from '@/lib/media'
import { resolveHref } from '@/lib/quote'

type FeaturedProjectProps = {
  project: Project | null
  eyebrow?: string | null
  ctaLabel?: string | null
}

/**
 * The featured project is derived from the projects collection, never stored on
 * the home global. Without a featured project the section renders nothing.
 */
export function FeaturedProject({
  project,
  eyebrow = 'Featured Project',
  ctaLabel = 'View Project Details',
}: FeaturedProjectProps) {
  if (!project) return null

  const imageUrl = mediaUrl(project.heroImage)
  const image = project.heroImage && typeof project.heroImage === 'object' ? project.heroImage : null
  const href = `/projects/${project.slug}`

  return (
    <Reveal className="home-feat" testId="featured-project">
      <SafeImage
        src={imageUrl}
        alt={image?.alt || project.title}
        width={image?.width ?? 1400}
        height={image?.height ?? 933}
        sizes="(max-width: 900px) 100vw, 50vw"
      />
      <div className="home-feat-body">
        {eyebrow ? (
          <p className="eyebrow" style={{ color: '#ffb4ae' }}>
            {eyebrow}
          </p>
        ) : null}
        <h3>
          {project.title} — {project.location}
        </h3>
        <p>{project.intro}</p>
        <Link className="btn btn-accent" href={resolveHref(href)}>
          {ctaLabel}
        </Link>
      </div>
    </Reveal>
  )
}
