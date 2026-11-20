import { RichText } from '@payloadcms/richtext-lexical/react'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

import type { TeamMember } from '@/payload-types'
import { mediaUrl } from '@/lib/media'

import { Reveal } from '@/components/ui/Reveal'
import { SafeImage } from '@/components/ui/SafeImage'

type TeamGridProps = {
  members: TeamMember[]
}

/**
 * The template's team card grid: one circular portrait (or the member's
 * initials when no photo is uploaded), the name, the role and the bio.
 */
export function TeamGrid({ members }: TeamGridProps) {
  return (
    <div className="team-grid">
      {members.map((member) => {
        const photo = member.photo && typeof member.photo === 'object' ? member.photo : null
        const bio = member.bio as SerializedEditorState | null | undefined
        const initials = member.initials?.trim()

        return (
          <Reveal as="article" key={member.id} className="team-card" testId="team-member">
            {photo ? (
              <SafeImage
                className="team-photo"
                src={mediaUrl(member.photo)}
                alt={photo.alt || member.name}
                width={photo.width ?? 168}
                height={photo.height ?? 168}
                sizes="84px"
              />
            ) : initials ? (
              <div className="team-initials" aria-hidden="true">
                {initials}
              </div>
            ) : null}

            <h3>{member.name}</h3>
            <p className="team-role">{member.role}</p>
            {bio?.root ? <RichText data={bio} disableContainer /> : null}
          </Reveal>
        )
      })}
    </div>
  )
}
