import type { CapabilitiesPage } from '@/payload-types'
import { SectionHead } from '@/components/ui/SectionHead'

import { CapabilityCard, type CapabilityIconName } from './CapabilityCard'

type CapabilityGridProps = {
  intro: CapabilitiesPage['intro'] | null
  capabilities?: CapabilitiesPage['capabilities']
}

/**
 * Icons follow the seeded card positions. The first capability is the feature
 * panel (photo + bullets) and the third is the shop-drawings card, which uses a
 * photo instead; the remaining five keep the template's icons.
 */
const CARD_ICONS: (CapabilityIconName | null)[] = [
  'design',
  null,
  'inspection',
  'assembly',
  'shipping',
  'support',
]

export function CapabilityGrid({ intro, capabilities }: CapabilityGridProps) {
  const items = capabilities ?? []
  const [featured, ...cards] = items

  return (
    <section
      className="caps"
      id="capabilities"
      aria-labelledby={intro?.title ? 'caps-h' : undefined}
    >
      <div className="wrap">
        {intro?.title ? (
          <SectionHead
            eyebrow={intro.eyebrow}
            title={intro.title}
            body={intro.body}
            id="caps-h"
            reveal
          />
        ) : null}

        {featured ? <CapabilityCard capability={featured} featured /> : null}

        {cards.length > 0 ? (
          <div className="cap-grid">
            {cards.map((capability, index) => (
              <CapabilityCard
                key={`${capability.title}-${index}`}
                capability={capability}
                icon={CARD_ICONS[index] ?? null}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
