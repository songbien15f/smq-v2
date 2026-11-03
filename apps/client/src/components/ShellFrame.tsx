/**
 * The workspace chrome: a navy bar with the mark, the company name and a way out.
 *
 * A separate file rather than a named export from `layout.tsx`, because Next only
 * allows a fixed set of exports from a layout and a component export there fails the
 * build with a message that does not point at the cause.
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
}

/** The links a set of capabilities may reach, in the order they matter. */
function navFor(capabilities: readonly string[]): { href: string; label: string }[] {
  const links = [{ href: '/quotes', label: 'Quotes' }];
  if (capabilities.includes('settings:manage')) links.push({ href: '/settings', label: 'Settings' });
  if (capabilities.includes('members:manage')) links.push({ href: '/team', label: 'Team' });
  return links;
}

export function ShellFrame({
  children,
  companyName,
  account,
  subtitle,
  capabilities,
}: ShellFrameProps) {
  const nav = capabilities === undefined ? [] : navFor(capabilities);
  return (
    <div className="min-h-dvh bg-sq-ground">
      <header className="sq-on-brand bg-sq-brand">
        <div className="mx-auto flex min-h-12 max-w-[1400px] flex-wrap items-center justify-between gap-sq-2 px-sq-3">
          <a href="/quotes" className="flex items-center gap-2 no-underline">
            <BrandMark size={22} tone="brand" title="" />
            <span className="text-sq-body font-semibold text-white">SmartQuote</span>
            {companyName !== undefined && companyName !== null && (
              <>
                <span className="text-sq-ink-muted" aria-hidden="true">
                  /
                </span>
                <span className="text-sq-body text-sq-gold">{companyName}</span>
              </>
            )}
          </a>
          <div className="flex items-center gap-sq-2">
            {nav.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="hidden min-h-11 items-center rounded-md px-sq-2 text-sq-body font-medium text-white/80 no-underline transition-colors duration-sq-fast hover:bg-sq-brand-hover hover:text-white sm:inline-flex"
              >
                {link.label}
              </a>
            ))}
            {account}
          </div>
        </div>
        {subtitle !== undefined && (
          <div className="mx-auto max-w-[1400px] px-sq-3 pb-sq-2 text-sq-micro text-white/70">
            {subtitle}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1400px] px-sq-3 py-sq-6">{children}</main>

      <footer className="mx-auto max-w-[1400px] px-sq-3 pb-sq-6 text-sq-micro text-sq-ink-muted">
        Prices are indicative until a revision is issued. GST is included and shown separately.
      </footer>
    </div>
  );
}
