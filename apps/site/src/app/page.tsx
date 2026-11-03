import { BrandMark } from '@sq/ui';
import { EnquiryForm } from '@/components/EnquiryForm';

/**
 * The end-customer site.
 *
 * Written for the person who is buying a shed, not for the company selling it. That
 * changes the density (spacious, 16 px body), the vocabulary (no "BOM", no "revision")
 * and the promise: what a quote will actually contain, and what it will not.
 *
 * The wind-rating paragraph is deliberately careful. A quote must state wind region,
 * terrain category and site wind speed, and a ShedSafe *certificate* requires the
 * manufacturer's own ShedSafe account — claiming one here would be false.
 */

export default function SiteHomePage() {
  return (
    <div className="min-h-dvh bg-sq-surface">
      <header className="bg-sq-brand text-white">
        <div className="mx-auto flex min-h-14 max-w-[1100px] items-center justify-between px-sq-4">
          <span className="flex items-center gap-2">
            <BrandMark size={24} tone="brand" title="" />
            <span className="font-semibold">Sheds, quoted</span>
          </span>
          <a
            href="#enquire"
            className="inline-flex min-h-[44px] items-center rounded-md bg-sq-gold px-sq-3 font-medium text-sq-brand no-underline"
          >
            Ask for a quote
          </a>
        </div>

        <div className="mx-auto max-w-[1100px] px-sq-4 pb-sq-8 pt-sq-6">
          <h1 className="max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">
            A shed price that can be explained, line by line.
          </h1>
          <p className="mt-3 max-w-2xl text-white/85">
            A steel shed is thousands of parts. The price is not the floor area times a rate — it is
            the roof and wall sheets, the purlins and girts, the gutters and flashings, the brackets,
            bolts and screws, counted from the building you actually described.
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1100px] flex-col gap-sq-8 px-sq-4 py-sq-8">
        <section aria-labelledby="what-you-get" className="flex flex-col gap-sq-4">
          <h2 id="what-you-get" className="text-sq-title font-semibold">
            What a quote contains
          </h2>
          <ul className="grid gap-sq-3 sm:grid-cols-2">
            {[
              {
                title: 'A drawing you can check',
                // "and elevations" was here and there are none: the document renders a plan only.
                // A customer who approves a shed on a promise of elevation drawings and receives a
                // plan has been told something untrue by the marketing page.
                body: 'A plan of the shed you described, with the door and window positions where you asked for them.',
              },
              {
                title: 'Every material, counted',
                body: 'Sheets, purlins, girts, gutters, downpipes, flashings, brackets, bolts and screws — with quantities, not an allowance.',
              },
              {
                title: 'A price with its parts',
                body: 'Materials, delivery, engineering and any extras, shown separately, so the total is the sum of things you can see.',
              },
              {
                title: 'Payment stages',
                body: 'A deposit on signing, a progress payment at frame stage, and the balance before delivery — stated, not negotiated later.',
              },
            ].map((item) => (
              <li key={item.title} className="rounded-lg border border-sq-line p-sq-4">
                <h3 className="font-semibold text-sq-ink">{item.title}</h3>
                <p className="mt-1 text-sq-body text-sq-ink-muted">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="wind" className="rounded-lg bg-sq-ground p-sq-4">
          <h2 id="wind" className="text-sq-title font-semibold">
            The wind rating, stated plainly
          </h2>
          <p className="mt-2 max-w-3xl text-sq-body text-sq-ink">
            Every quote states the <strong>wind region</strong>, the <strong>terrain category</strong>,
            the <strong>importance level</strong> and the <strong>site wind speed in metres per
            second</strong>, calculated to AS/NZS 1170.2. If a quote you have been given shows an
            obsolete code such as <span className="sq-numeric">W41</span> or{' '}
            <span className="sq-numeric">N2</span> instead, ask why.
          </p>
          <p className="mt-2 max-w-3xl text-sq-body text-sq-ink-muted">
            A formal ShedSafe certificate is issued by the manufacturer through their own ShedSafe
            account. The figures on our quotes are a calculation to the standard, and we say so rather
            than implying a certificate we cannot issue.
          </p>
        </section>

        <section aria-labelledby="enquire" id="enquire" className="flex flex-col gap-sq-3">
          <h2 id="enquire" className="text-sq-title font-semibold">
            Tell us about the shed
          </h2>
          <p className="max-w-2xl text-sq-body text-sq-ink-muted">
            Width, length, wall height, roof pitch, and where the doors go. If you have a plan or a
            sketch, mention it and we will ask for it.
          </p>
          <EnquiryForm />
        </section>
      </main>

      <footer className="border-t border-sq-line px-sq-4 py-sq-6 text-sq-body text-sq-ink-muted">
        <div className="mx-auto max-w-[1100px]">
          Prices include GST where stated. Dimensions are shown in millimetres, as the trade uses.
        </div>
      </footer>
    </div>
  );
}
