import Link from 'next/link'
import { RichText } from '@payloadcms/richtext-lexical/react'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

import type { Project, ProjectDetailSetting } from '@/payload-types'
import { SafeImage } from '@/components/ui/SafeImage'
import { ALL_PROJECTS_LABEL, PRICE_SIMILAR_PROJECT_LABEL, sectorLabel } from '@/lib/labels'
import { mediaUrl } from '@/lib/media'

/** The previous/next project computed from the full project list, wrapping. */
export type ProjectSibling = Pick<Project, 'slug' | 'title' | 'location'>

type ProjectDetailProps = {
  project: Project
  settings: ProjectDetailSetting
  prev?: ProjectSibling | null
  next?: ProjectSibling | null
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m4 12.5 5 5L20 6.5"
        stroke="#ff5a5f"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const imageDoc = (media: unknown) =>
  media && typeof media === 'object'
    ? (media as { alt?: string | null; width?: number | null; height?: number | null })
    : null

/**
 * The template's project detail body: hero photo, overview rich text, the scope
 * list, the three delivery stages, the QA pack, the facts card and the
 * previous/next navigation.
 *
 * Location, Sector and Structure come from the project document. Everything
 * else — the stage photos and copy, the QA document list and the three
 * fabrication/standards/delivery facts — is the project-detail global, because
 * the template renders it identically on every project.
 */
export function ProjectDetail({ project, settings, prev, next }: ProjectDetailProps) {
  const heroImage = imageDoc(project.heroImage)
  const scope = project.scope ?? []
  const overview = project.overview as SerializedEditorState | null | undefined

  const stages = (settings.stages ?? []).filter((stage) => stage.title && stage.text)
  const qaDocs = (settings.qaDocs ?? []).filter((doc) => doc.label)
  const globalFacts = (settings.facts ?? []).filter((fact) => fact.label && fact.value)

  const sector = sectorLabel(project.sector)
  const structure = project.structure

  return (
    <section style={{ paddingTop: 44 }}>
      <div className="wrap">
        <SafeImage
          className="detail-hero-img"
          src={mediaUrl(project.heroImage)}
          alt={heroImage?.alt || project.title}
          width={heroImage?.width ?? 1800}
          height={heroImage?.height ?? 771}
          priority
          sizes="(max-width: 1240px) 100vw, 1200px"
        />

        <div className="detail-layout">
          <div className="detail-main">
            {overview?.root ? (
              <>
                <h2>Project overview</h2>
                <RichText data={overview} disableContainer />
              </>
            ) : project.intro ? (
              <>
                <h2>Project overview</h2>
                <p>{project.intro}</p>
              </>
            ) : null}

            {scope.length > 0 ? (
              <>
                <h2>Our scope</h2>
                <ul className="scope-list" role="list" data-testid="project-scope">
                  {scope.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <CheckIcon />
                      {item}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {stages.length > 0 ? (
              <>
                <h2>How it was delivered</h2>
                {settings.stagesIntro ? <p>{settings.stagesIntro}</p> : null}
                <div className="stage-gallery" data-testid="project-stages">
                  {stages.map((stage, index) => {
                    const image = imageDoc(stage.image)
                    return (
                      <figure key={stage.id ?? index}>
                        <SafeImage
                          src={mediaUrl(stage.image)}
                          alt={image?.alt || stage.title}
                          width={image?.width ?? 900}
                          height={image?.height ?? 675}
                          sizes="(max-width: 620px) 100vw, (max-width: 980px) 50vw, 33vw"
                        />
                        <figcaption>
                          <strong>{stage.title}</strong>
                          {stage.text}
                        </figcaption>
                      </figure>
                    )
                  })}
                </div>
              </>
            ) : null}

            {qaDocs.length > 0 ? (
              <>
                <h2>QA documentation supplied</h2>
                {settings.qaIntro ? <p>{settings.qaIntro}</p> : null}
                <div className="spec-chips" data-testid="project-qa-docs">
                  {qaDocs.map((doc, index) => (
                    <span className="chip" key={doc.id ?? index}>
                      {doc.label}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <aside className="facts-card" aria-labelledby="project-facts-h">
            <h3 id="project-facts-h">Project facts</h3>
            <dl>
              <div className="fact">
                <dt>Location</dt>
                <dd>{project.location}</dd>
              </div>
              {sector ? (
                <div className="fact">
                  <dt>Sector</dt>
                  <dd>{sector}</dd>
                </div>
              ) : null}
              {structure ? (
                <div className="fact">
                  <dt>Structure</dt>
                  <dd>{structure}</dd>
                </div>
              ) : null}
              {globalFacts.map((fact, index) => (
                <div className="fact" key={fact.id ?? `${fact.label}-${index}`}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
            <Link className="btn btn-accent" href="/quote">
              {settings.priceCta || PRICE_SIMILAR_PROJECT_LABEL}
            </Link>
            {settings.contactPromptLead && settings.contactPromptLabel ? (
              <p className="facts-contact">
                {settings.contactPromptLead}{' '}
                <Link className="facts-contact-link" href="/contact">
                  {settings.contactPromptLabel}
                </Link>
                .
              </p>
            ) : null}
          </aside>
        </div>

        <div className="detail-nav">
          {prev ? (
            <Link className="btn btn-dark" href={`/projects/${prev.slug}`}>
              ← Previous: {prev.title}
            </Link>
          ) : null}
          <Link className="btn btn-dark" href="/projects">
            ← {ALL_PROJECTS_LABEL}
          </Link>
          {next ? (
            <Link className="btn btn-dark" href={`/projects/${next.slug}`}>
              Next: {next.title} →
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  )
}
