import type { ReactNode } from 'react'

import type { HomePage } from '@/payload-types'
import { Reveal } from '@/components/ui/Reveal'
import { resolveHref } from '@/lib/quote'

type ExploreCardsProps = {
  intro: HomePage['exploreIntro']
  cards?: HomePage['exploreCards']
  /** The featured project card, rendered inside the explore section like the template. */
  children?: ReactNode
}

export function ExploreCards({ intro, cards, children }: ExploreCardsProps) {
  const hasCards = Boolean(cards?.length)

  // The section always renders so the featured project (children) keeps its
  // template placement and background even when editors clear the card list.
  return (
    <section className="explore" aria-labelledby="explore-h">
      <div className="wrap">
        {intro?.title ? (
          <Reveal className="section-head">
            {intro.eyebrow ? <p className="eyebrow">{intro.eyebrow}</p> : null}
            <h2 id="explore-h">{intro.title}</h2>
            {intro.body ? <p className="section-sub">{intro.body}</p> : null}
          </Reveal>
        ) : null}
        {hasCards ? (
          <div className="explore-grid">
            {cards?.map((card, index) => (
              <Reveal
                as="a"
                key={`${card.href}-${index}`}
                className="link-card"
                href={resolveHref(card.href)}
                testId="explore-card"
              >
                <h3>{card.title}</h3>
                {card.body ? <p>{card.body}</p> : null}
                <span className="go">{card.ctaLabel}</span>
              </Reveal>
            ))}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  )
}
