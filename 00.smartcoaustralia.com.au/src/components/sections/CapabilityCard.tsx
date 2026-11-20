import type { ReactNode } from 'react'

import type { CapabilitiesPage } from '@/payload-types'
import { Reveal } from '@/components/ui/Reveal'
import { SafeImage } from '@/components/ui/SafeImage'
import { mediaUrl } from '@/lib/media'

export type Capability = NonNullable<CapabilitiesPage['capabilities']>[number]

export type CapabilityIconName = 'design' | 'inspection' | 'assembly' | 'shipping' | 'support'

type CapabilityCardProps = {
  capability: Capability
  /** The first capability is rendered as the full-width `.cap-feature` panel. */
  featured?: boolean
  icon?: CapabilityIconName | null
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m4 12.5 5 5L20 6.5"
        stroke={color}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CapabilityIcon({ name }: { name: CapabilityIconName }) {
  let glyph: ReactNode = null

  switch (name) {
    case 'design':
      glyph = (
        <>
          <path
            d="M4 20 20 4M4 4v5M4 4h5M20 20v-5M20 20h-5"
            stroke="#ff5a5f"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="2.6" stroke="#edf1fc" strokeWidth="2" />
        </>
      )
      break
    case 'inspection':
      glyph = (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" stroke="#edf1fc" strokeWidth="2" />
          <path d="m15.5 15.5 5 5" stroke="#ff5a5f" strokeWidth="2.4" strokeLinecap="round" />
          <path
            d="m7.8 10.5 2 2 3.4-3.8"
            stroke="#ff5a5f"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )
      break
    case 'assembly':
      glyph = (
        <>
          <path
            d="M4 17 12 5l8 12M7.5 12.5h9"
            stroke="#edf1fc"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M3 20h18" stroke="#ff5a5f" strokeWidth="2.2" strokeLinecap="round" />
        </>
      )
      break
    case 'shipping':
      glyph = (
        <>
          <path
            d="M3 8h13v9H3zM16 11h3.2L21 13.5V17h-5"
            stroke="#edf1fc"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="7" cy="17.5" r="1.8" stroke="#ff5a5f" strokeWidth="2" />
          <circle cx="17.5" cy="17.5" r="1.8" stroke="#ff5a5f" strokeWidth="2" />
        </>
      )
      break
    case 'support':
      glyph = (
        <>
          <path d="M5 4h11l3 3v13H5z" stroke="#edf1fc" strokeWidth="2" strokeLinejoin="round" />
          <path d="M8.5 12.5h7M8.5 16h7" stroke="#ff5a5f" strokeWidth="2" strokeLinecap="round" />
        </>
      )
      break
  }

  return (
    <div className="cap-icon" aria-hidden="true">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        {glyph}
      </svg>
    </div>
  )
}

export function CapabilityCard({ capability, featured = false, icon }: CapabilityCardProps) {
  const { title, body, features, image } = capability
  const imageUrl = mediaUrl(image)
  const imageDoc = image && typeof image === 'object' ? image : null
  const bullets = features ?? []

  if (featured) {
    return (
      <Reveal className="cap-feature" testId="capability-card">
        <SafeImage
          src={imageUrl}
          alt={imageDoc?.alt || title}
          width={imageDoc?.width ?? 1800}
          height={imageDoc?.height ?? 900}
          sizes="(max-width: 980px) 100vw, 55vw"
        />
        <div className="cap-feature-body">
          <h3>{title}</h3>
          <p>{body}</p>
          {bullets.length > 0 ? (
            <ul>
              {bullets.map((feature, index) => (
                <li key={`${feature.text}-${index}`}>
                  <CheckIcon color="#ff5a5f" />
                  {feature.text}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Reveal>
    )
  }

  return (
    <Reveal as="article" className="cap-card" testId="capability-card">
      {imageUrl ? (
        <SafeImage
          src={imageUrl}
          alt={imageDoc?.alt || title}
          width={imageDoc?.width ?? 800}
          height={imageDoc?.height ?? 600}
          className="cap-photo"
          sizes="(max-width: 620px) 100vw, (max-width: 980px) 50vw, 33vw"
        />
      ) : icon ? (
        <CapabilityIcon name={icon} />
      ) : null}
      <h3>{title}</h3>
      <p>{body}</p>
      {bullets.length > 0 ? (
        <ul className="cap-features">
          {bullets.map((feature, index) => (
            <li key={`${feature.text}-${index}`}>
              <CheckIcon color="#e83238" />
              {feature.text}
            </li>
          ))}
        </ul>
      ) : null}
    </Reveal>
  )
}
