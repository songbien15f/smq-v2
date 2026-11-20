import Link from 'next/link'

import type { HomePage } from '@/payload-types'
import { SafeImage } from '@/components/ui/SafeImage'
import { mediaUrl } from '@/lib/media'

import { StatStrip } from './StatStrip'
import { resolveHref } from '@/lib/quote'

type HeroHomeProps = {
  hero: HomePage['hero']
  stats: HomePage['stats']
}

/** Splits the headline around the highlighted phrase so it can be accented. */
function headlineParts(title: string, highlight?: string | null) {
  if (!highlight) return { before: title, match: '', after: '' }

  const index = title.indexOf(highlight)
  if (index === -1) return { before: title, match: '', after: '' }

  return {
    before: title.slice(0, index),
    match: highlight,
    after: title.slice(index + highlight.length),
  }
}

export function HeroHome({ hero, stats }: HeroHomeProps) {
  const { before, match, after } = headlineParts(hero.title, hero.highlight)
  const imageUrl = mediaUrl(hero.image)
  const image = hero.image && typeof hero.image === 'object' ? hero.image : null

  return (
    <div className="hero">
      <div className="hero-media" data-testid="hero-media">
        <SafeImage
          src={imageUrl}
          alt={image?.alt ?? ''}
          width={image?.width ?? 2400}
          height={image?.height ?? 1350}
          priority
          sizes="100vw"
        />
      </div>
      <div className="wrap hero-in">
        <p className="hero-kicker">{hero.kicker}</p>
        <h1>
          {before}
          {match ? <span className="hl">{match}</span> : null}
          {after}
        </h1>
        <p className="hero-lede">{hero.lede}</p>
        <div className="hero-ctas">
          <Link className="btn btn-accent" href={resolveHref(hero.primaryHref)}>
            {hero.primaryLabel}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 12h14m-6-6 6 6-6 6"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <Link className="btn btn-ghost" href={resolveHref(hero.secondaryHref)}>
            {hero.secondaryLabel}
          </Link>
        </div>
        <StatStrip stats={stats} />
      </div>
    </div>
  )
}
