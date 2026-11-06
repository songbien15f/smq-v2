/**
 * The workspace chrome: a rail that holds the navigation, and a top bar that names the screen.
 *
 * ## Why a rail rather than a bar
 *
 * The old shell was a navy strip across the top, which cost the full width of the page and bought
 * nothing but links. A rail moves the same links off the working area, so a materials table or a
 * quote list gets the whole width — which is what this product is for. The catalogue's
 * `data-dense-dashboard` profile puts the same figure on it: a 232 px sidebar and a 44 px row.
 *
 * ## Below `lg` it is a strip again
 *
 * A rail on a 375 px screen would be a 232 px column of navigation and nothing else. So below `lg`
 * the rail becomes a horizontal strip of the same items, and the account control moves into it. One
 * component, two arrangements, no second implementation of the navigation.
 *
 * ## `title` and `actions` are optional on purpose
 *
 * A screen with a heading and a primary action passes them here and gets the top bar for free; a
 * screen that renders its own header keeps working untouched. That is what let this land without
 * editing every page.
 */

import { BrandMark } from '@sq/ui';

export interface ShellFrameProps {
  children: React.ReactNode;
  /**
   * The company name, shown so a person always knows which workspace they are in.
   *
   * `null` is a real state — platform staff belong to no company — so it is accepted rather than
   * forcing every caller to convert it, which is how a `?? ''` ends up rendering an empty slash.
   */
  companyName?: string | null;
  /** Rendered at the right of the bar: sign-out, or a sign-in link. */
  account?: React.ReactNode;
  /**
   * The signed-in person's capabilities, from which the navigation is derived.
   *
   * Capabilities rather than a list of links, so a page cannot offer a link the role may not use and
   * cannot forget one it may. The API refuses the operation regardless; this is so the screen never
   * shows a door that does not open.
   */
  capabilities?: readonly string[];
  /** Shown under the bar, e.g. "signed in as …". */
  subtitle?: string;
  /** The screen's name, in the top bar. Omit to render no top bar. */
  title?: string;
  /** A line under the title — a count, a hint, the company's state. */
  caption?: string;
  /** Right-aligned controls in the top bar: the primary action, and its alternative. */
  actions?: React.ReactNode;
}

/** The links a set of capabilities may reach, in the order they matter. */
function navFor(capabilities: readonly string[]): { href: string; label: string }[] {
  const links = [{ href: '/quotes', label: 'Quotes' }];
  if (capabilities.includes('settings:manage')) links.push({ href: '/settings', label: 'Settings' });
  if (capabilities.includes('members:manage')) links.push({ href: '/team', label: 'Team' });
  /*
   * Last, because it is the least-used screen: an owner checks activity occasionally, and a link
   * that competes for attention with Quotes is a link in the wrong order. `usage:read` today is
   * `company_admin` only, so an estimator sees no entry point — the server refuses the page too.
   */
  if (capabilities.includes('usage:read')) links.push({ href: '/activity', label: 'Activity' });
  return links;
}

export function ShellFrame({
  children,
  companyName,
  account,
  subtitle,
  capabilities,
  title,
  caption,
  actions,
}: ShellFrameProps) {
  const nav = capabilities === undefined ? [] : navFor(capabilities);
  const hasCompany = companyName !== undefined && companyName !== null;

  return (
    <div className="min-h-dvh bg-sq-ground lg:grid lg:grid-cols-[232px_1fr]">
      {/*
        The rail. One element, arranged by breakpoint: a horizontal strip of links on a phone, a
        vertical column on a desktop. `sq-on-brand` swaps the focus ring to gold, because a navy ring
        on navy is invisible.
      */}
      <aside className="sq-on-brand flex items-center gap-sq-2 overflow-x-auto bg-sq-brand px-sq-3 py-sq-2 text-white lg:flex-col lg:items-stretch lg:gap-sq-6 lg:overflow-visible lg:px-sq-3 lg:py-sq-4">
        <a href="/quotes" className="flex min-h-11 shrink-0 items-center gap-2 no-underline">
          <BrandMark size={24} tone="brand" title="" />
          <span className="text-sq-body font-semibold text-white">SmartQuote</span>
        </a>

        <nav className="flex items-center gap-sq-1 lg:flex-col lg:items-stretch lg:gap-1">
          {nav.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="inline-flex min-h-11 shrink-0 items-center rounded-sq-md px-sq-2 text-sq-body font-medium text-white/75 no-underline transition-colors duration-sq-fast hover:bg-sq-brand-hover hover:text-white lg:px-sq-3"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* On a phone the account control rides in the strip; on a desktop it sits at the foot. */}
        <div className="ml-auto shrink-0 lg:ml-0 lg:mt-auto lg:shrink">
          <div className="flex items-center gap-sq-2 lg:hidden">{account}</div>
          <div className="hidden lg:block">
            {account}
            {(hasCompany || subtitle !== undefined) && (
              <div className="mt-sq-3 border-t border-white/15 pt-sq-3 text-sq-micro leading-relaxed text-white/55">
                {hasCompany && <b className="block text-sq-body font-semibold text-white">{companyName}</b>}
                {subtitle}
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {title !== undefined && (
          <header className="flex flex-wrap items-end justify-between gap-sq-3 border-b border-sq-line bg-sq-surface px-sq-4 py-sq-4">
            <div>
              <h1 className="text-sq-display font-semibold tracking-tight text-sq-ink">{title}</h1>
              {caption !== undefined && <p className="mt-1 text-sq-body text-sq-ink-muted">{caption}</p>}
            </div>
            {actions !== undefined && <div className="flex flex-wrap items-center gap-sq-2">{actions}</div>}
          </header>
        )}

        <main className="min-w-0 flex-1 px-sq-4 py-sq-6">{children}</main>

        <footer className="px-sq-4 pb-sq-6 text-sq-micro text-sq-ink-muted">
          Prices are indicative until a revision is issued. GST is included and shown separately.
        </footer>
      </div>
    </div>
  );
}
