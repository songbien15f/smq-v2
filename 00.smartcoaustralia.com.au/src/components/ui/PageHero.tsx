import type { ReactNode } from 'react'

import { Breadcrumbs } from './Breadcrumbs'

type PageHeroParent = {
  label: string
  href: string
}

type PageHeroProps = {
  eyebrow?: string | null
  title: string
  lede?: string | null
  /** Content placed directly below the lede, e.g. the project spec chips. */
  afterLede?: ReactNode
  /** An extra crumb between Home and the current page, e.g. Projects. */
  parent?: PageHeroParent
  children?: ReactNode
}

/**
 * Navy page header shared by every inner page: a breadcrumb, the page's single
 * `h1` and lede, plus an optional spec row and action row. Mirrors the
 * template's `.page-hero > .wrap` structure.
 *
 * The breadcrumb's current label derives from the eyebrow (falling back to the
 * title), so the seeded eyebrows — which are already the page names — drive the
 * trail with no schema change.
 */
export function PageHero({ eyebrow, title, lede, afterLede, parent, children }: PageHeroProps) {
  const current = eyebrow ?? title
  const trail = parent
    ? [{ label: parent.label, href: parent.href }, { label: current }]
    : [{ label: current }]

  return (
    <div className="page-hero">
      <div className="wrap">
        <Breadcrumbs items={trail} />
        <h1>{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
        {afterLede ? <div className="spec-chips">{afterLede}</div> : null}
        {children ? <div className="hero-actions">{children}</div> : null}
      </div>
    </div>
  )
}
