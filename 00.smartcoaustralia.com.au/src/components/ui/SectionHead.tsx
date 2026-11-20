import { Reveal } from './Reveal'

type SectionHeadProps = {
  eyebrow?: string | null
  title: string
  body?: string | null
  id?: string
  /** Wrap the heading in the scroll-reveal primitive (template `.reveal`). */
  reveal?: boolean
  className?: string
}

const classesFor = (className?: string) => ['section-head', className].filter(Boolean).join(' ')

/**
 * Section heading used across the inner pages: eyebrow, `h2` and optional
 * supporting paragraph, matching the template's `.section-head` markup.
 */
export function SectionHead({
  eyebrow,
  title,
  body,
  id,
  reveal = false,
  className,
}: SectionHeadProps) {
  const content = (
    <>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2 id={id}>{title}</h2>
      {body ? <p className="section-sub">{body}</p> : null}
    </>
  )

  if (reveal) {
    return <Reveal className={classesFor(className)}>{content}</Reveal>
  }

  return <div className={classesFor(className)}>{content}</div>
}
