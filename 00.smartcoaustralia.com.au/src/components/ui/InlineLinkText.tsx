import { resolveHref } from '@/lib/quote'

type InlineLinkTextProps = {
  /** Full sentence copy as seeded. */
  text: string
  /** The phrase inside `text` that should become the link. */
  label?: string | null
  href?: string | null
}

/**
 * Renders copy with one phrase turned into a link.
 *
 * CMS text fields are plain strings, so a sentence that must link mid-way (the
 * consent label, the contact page intro) is stored whole and split at the
 * anchor phrase here. When the phrase or href is missing the text renders
 * unchanged rather than losing words.
 */
export function InlineLinkText({ text, label, href }: InlineLinkTextProps) {
  if (!label || !href) return <>{text}</>

  const index = text.indexOf(label)
  if (index === -1) return <>{text}</>

  return (
    <>
      {text.slice(0, index)}
      <a href={resolveHref(href)}>{label}</a>
      {text.slice(index + label.length)}
    </>
  )
}
