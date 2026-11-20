import type { ProcessPage } from '@/payload-types'

import { Reveal } from '@/components/ui/Reveal'
import { SectionHead } from '@/components/ui/SectionHead'

type ProcessStepsProps = {
  intro?: ProcessPage['intro'] | null
  steps?: ProcessPage['steps']
}

/**
 * The template's process section: `.section-head` followed by an ordered
 * `.process-steps` list of `.step` items. Step numbers come from the array
 * position, so reordering in the admin renumbers the page.
 */
export function ProcessSteps({ intro, steps }: ProcessStepsProps) {
  const items = steps ?? []

  return (
    <section
      id="process"
      aria-labelledby={intro?.title ? 'process-h' : undefined}
    >
      <div className="wrap">
        {intro?.title ? (
          <SectionHead
            eyebrow={intro.eyebrow}
            title={intro.title}
            body={intro.body}
            id="process-h"
            reveal
          />
        ) : null}

        {items.length > 0 ? (
          <ol className="process-steps">
            {items.map((step, index) => (
              <Reveal
                key={`${step.title}-${index}`}
                as="li"
                className="step"
                testId="process-step"
              >
                <span className="step-num">{index + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        ) : null}
      </div>
    </section>
  )
}
