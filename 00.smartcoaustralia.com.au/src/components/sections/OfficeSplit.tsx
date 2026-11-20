import type { HomePage } from '@/payload-types'
import { Reveal } from '@/components/ui/Reveal'
import { SafeImage } from '@/components/ui/SafeImage'
import { mediaUrl } from '@/lib/media'

type OfficeSplitProps = {
  officeSplit: HomePage['officeSplit']
}

export function OfficeSplit({ officeSplit }: OfficeSplitProps) {
  const imageUrl = mediaUrl(officeSplit.image)
  const image = officeSplit.image && typeof officeSplit.image === 'object' ? officeSplit.image : null
  const cards = officeSplit.offices ?? []

  return (
    <section aria-labelledby="worlds-h">
      <div className="wrap worlds">
        <Reveal>
          {officeSplit.eyebrow ? <p className="eyebrow">{officeSplit.eyebrow}</p> : null}
          <h2 id="worlds-h">{officeSplit.title}</h2>
          {officeSplit.body ? <p className="section-sub">{officeSplit.body}</p> : null}
          {cards.length > 0 ? (
            <div className="office-cards">
              {cards.map((office, index) => (
                <div className="office-mini" key={`${office.code}-${index}`}>
                  <span className="flag" aria-hidden="true">
                    {office.code}
                  </span>
                  <div>
                    <h3>{office.title}</h3>
                    <p>{office.body}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </Reveal>
        <Reveal as="figure" className="worlds-photo">
          <SafeImage
            src={imageUrl}
            alt={officeSplit.imageAlt || image?.alt || ''}
            width={image?.width ?? 800}
            height={image?.height ?? 600}
            sizes="(max-width: 900px) 100vw, 48vw"
          />
          {officeSplit.caption ? (
            <figcaption>
              {officeSplit.captionLead ? <strong>{officeSplit.captionLead}</strong> : null}{' '}
              {officeSplit.caption}
            </figcaption>
          ) : null}
        </Reveal>
      </div>
    </section>
  )
}
