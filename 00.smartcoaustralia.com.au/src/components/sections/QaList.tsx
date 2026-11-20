import type { QualityPage } from '@/payload-types'

import { Reveal } from '@/components/ui/Reveal'

type QaListProps = {
  items?: QualityPage['qaItems']
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

/**
 * The template's `.qa-list`: a two-column list of QA documents, each with a
 * title and a short supporting line. The list is rendered inside the dark
 * `.quality` panel, so the row text inherits the navy ink colour.
 *
 * `role="list"` restates list semantics that the template stylesheet removes
 * with `list-style: none`.
 */
export function QaList({ items }: QaListProps) {
  const documents = items ?? []

  if (documents.length === 0) return null

  return (
    <ul className="qa-list" role="list">
      {documents.map((item, index) => (
        <Reveal
          as="li"
          key={`${item.title}-${index}`}
          testId="qa-item"
          className="qa-item"
        >
          <CheckIcon />
          <span>
            {item.title}
            {item.description ? <small>{item.description}</small> : null}
          </span>
        </Reveal>
      ))}
    </ul>
  )
}
