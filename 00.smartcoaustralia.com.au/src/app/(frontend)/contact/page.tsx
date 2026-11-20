import type { Metadata } from 'next'

import type { ContactPage } from '@/payload-types'
import { ContactForm } from '@/components/forms/ContactForm'
import { ContactOffices } from '@/components/sections/ContactOffices'
import { WhatsNext } from '@/components/sections/WhatsNext'
import { InlineLinkText } from '@/components/ui/InlineLinkText'
import { PageHero } from '@/components/ui/PageHero'
import { Reveal } from '@/components/ui/Reveal'
import { getOffices } from '@/lib/data'
import { getGlobal } from '@/lib/payload'
import { buildMetadata } from '@/lib/seo'
import { isListVisible, isSectionVisible } from '@/lib/visibility'
import { resolveHref } from '@/lib/quote'

export async function generateMetadata(): Promise<Metadata> {
  const page = await getGlobal<ContactPage>('contact-page')

  return buildMetadata({
    title: page?.meta?.title || 'Contact Us',
    description:
      page?.meta?.description ||
      'Two offices, one team — plus a dedicated Western Australia enquiry line. Call, email, visit, or send the form and the right office will come back to you.',
    path: '/contact',
  })
}

export default async function ContactPageView() {
  const [page, offices] = await Promise.all([
    getGlobal<ContactPage>('contact-page'),
    getOffices(),
  ])

  const showIntro = isSectionVisible(page.intro)
  const showQuickLinks = isListVisible(page.quickLinksVisible, page.quickLinks)
  const showWhatsNext = isListVisible(page.whatsNextVisible, page.whatsNext)
  // The contact form's copy is a set of top-level fields, not a section group,
  // so the form is always rendered; only the surrounding sections switch.
  const showForm = true
  const showTop = showIntro || showQuickLinks

  return (
    <main id="main">
      {isSectionVisible(page.hero) ? (
        <PageHero eyebrow={page.hero.eyebrow} title={page.hero.title} lede={page.hero.lede} />
      ) : null}

      {showTop ? (
        <section className="contact-top" id="contact" aria-labelledby="contact-h">
          <div className="wrap">
            {showIntro ? (
              <Reveal className="section-head">
                {page.intro.eyebrow ? <p className="eyebrow">{page.intro.eyebrow}</p> : null}
                <h2 id="contact-h">{page.intro.title}</h2>
                {page.intro.body ? (
                  <p className="section-sub">
                    <InlineLinkText
                      text={page.intro.body}
                      label={page.intro.linkLabel}
                      href={page.intro.linkHref}
                    />
                  </p>
                ) : null}
              </Reveal>
            ) : null}

            {showQuickLinks ? (
              <div className="quick-grid">
                {page.quickLinks.map((card, index) => (
                  <Reveal
                    as="a"
                    className="quick-card"
                    href={resolveHref(card.href)}
                    key={`${card.label}-${index}`}
                  >
                    <span className="q-label">{card.label}</span>
                    <span className="q-value">{card.value}</span>
                    {card.body ? <p>{card.body}</p> : null}
                  </Reveal>
                ))}
              </div>
            ) : null}

            <ContactOffices offices={offices} />
          </div>
        </section>
      ) : null}

      {showWhatsNext || showForm ? (
        <section className="contact-section" aria-labelledby="what-happens-next">
          <div className="wrap contact-layout">
            {showWhatsNext ? (
              <Reveal>
                <WhatsNext page={page} />
              </Reveal>
            ) : null}

            {showForm ? (
              <Reveal>
                <ContactForm
                  form={{
                    formTitle: page.formTitle,
                    formIntro: page.formIntro,
                    formNote: page.formNote,
                    consentLabel: page.consentLabel,
                    consentHref: page.consentHref,
                    successHeading: page.successHeading,
                    successBody: page.successBody,
                  }}
                  enquiryTypes={page.enquiryTypes.map((option) => option.label)}
                  sourcePath="/contact"
                />
              </Reveal>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  )
}
