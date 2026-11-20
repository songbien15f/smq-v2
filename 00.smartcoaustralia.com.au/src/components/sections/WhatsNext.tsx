import type { ContactPage } from '@/payload-types'
import { Reveal } from '@/components/ui/Reveal'
import { resolveHref } from '@/lib/quote'

type WhatsNextProps = {
  page: ContactPage
}

/**
 * The left column of the contact section: the "What happens next" heading, the
 * three numbered steps and the pointer to the dedicated quote form.
 *
 * The template's third step describes its old mailto flow ("the form opens your
 * email app"); this site stores the message and notifies the office, so the
 * seeded body says drawings can follow by email instead. The heading is kept
 * verbatim.
 */
export function WhatsNext({ page }: WhatsNextProps) {
  const prompt = page.quotePrompt

  return (
    <>
      <p className="eyebrow">{page.whatsNextIntro.eyebrow}</p>
      <h2 id="what-happens-next">{page.whatsNextIntro.title}</h2>

      <ol className="next-steps">
        {page.whatsNext.map((step, index) => (
          <li key={`${step.title}-${index}`}>
            <span className="q-num" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      {prompt?.title && prompt?.body ? (
        <Reveal className="tool-slot contact-quote-prompt">
          <h3>{prompt.title}</h3>
          <p>{prompt.body}</p>
          {prompt.label && prompt.href ? (
            <a className="btn btn-accent" href={resolveHref(prompt.href)}>
              {prompt.label}
            </a>
          ) : null}
        </Reveal>
      ) : null}
    </>
  )
}
