/**
 * The "Quotes / Settings" line above a screen's heading.
 *
 * ## Why it is a component now
 *
 * The same five-line block was copied into six pages, which is how they all came to share a defect:
 * measured 2026-11-08, the link was **14–15 px tall**. WCAG 2.5.8 asks for 24 CSS px, and the inline
 * exception does not apply — this link is not inside a sentence, it is the only way back up a level.
 * A mouse finds it; a finger at 390 px does not, and the pointer target is one of the two rules this
 * product's own guidance says is critical.
 *
 * `min-h-11 -ml-sq-2 px-sq-2` gives the target 44 px without moving the text: the extra height is
 * padding and the negative margin keeps the visible left edge on the page's rhythm. A copy per page
 * would have to be fixed six times again, so it is one component with one padding.
 *
 * A `<nav>` with its own label rather than a bare paragraph: it is navigation, and assistive tech
 * should be able to skip to it or past it.
 */

export interface BreadcrumbProps {
  /** The trail, last item being the current screen. The final entry is text, not a link. */
  trail: { label: string; href?: string }[];
}

export function Breadcrumb({ trail }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className="text-sq-micro text-sq-ink-muted">
      <ol className="flex flex-wrap items-center gap-sq-1">
        {trail.map((step, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={`${step.label}-${index}`} className="flex items-center gap-sq-1">
              {step.href !== undefined && !last ? (
                <a
                  href={step.href}
                  className="-ml-sq-2 inline-flex min-h-11 items-center rounded px-sq-2 underline underline-offset-2 transition-colors duration-sq-fast hover:bg-sq-ground hover:text-sq-ink"
                >
                  {step.label}
                </a>
              ) : (
                <span className="inline-flex min-h-6 items-center" aria-current={last ? 'page' : undefined}>
                  {step.label}
                </span>
              )}
              {!last && (
                <span aria-hidden="true" className="text-sq-ink-muted/60">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
