import { BrandMark } from '@sq/ui';

/**
 * The admin shell.
 *
 * ## Why the nav is derived from capabilities
 *
 * The client's shell builds its links from the session's capabilities, and this one used to have no
 * nav at all — two pages, reachable only by typing a URL. A control plane whose screens are
 * undiscoverable is a control plane nobody uses. So the same rule applies here: a link appears
 * because the session holds the capability the API checks, never because the page guessed.
 *
 * ## Why the nav is passed in rather than read here
 *
 * This is a server component rendered by each page, and the session is already resolved there. A
 * second `serverFetch` per page to decide the nav would be a second round trip for a header.
 */

/** One destination, and the capability that makes it reachable. */
export interface AdminNavItem {
  href: string;
  label: string;
  capability: string;
}

/** Every screen, in the order the nav presents them. */
export const ADMIN_NAV: AdminNavItem[] = [
  { href: '/company', label: 'Company', capability: 'platform:companies' },
  { href: '/price-books', label: 'Price books', capability: 'platform:pricebooks' },
  { href: '/prices', label: 'Company prices', capability: 'platform:companies' },
  { href: '/seats', label: 'Seats', capability: 'platform:companies' },
  { href: '/enquiries', label: 'Enquiries', capability: 'platform:enquiries' },
  { href: '/platform', label: 'Usage', capability: 'platform:audit' },
  { href: '/audit', label: 'Audit', capability: 'platform:audit' },
];

export function ShellFrame({
  children,
  account,
  capabilities = [],
  current,
}: {
  children: React.ReactNode;
  account?: React.ReactNode;
  /** What the signed-in platform user may do, so the nav offers only reachable screens. */
  capabilities?: readonly string[];
  /** The current path, so its link reads as current rather than merely present. */
  current?: string;
}) {
  const items = ADMIN_NAV.filter((item) => capabilities.includes(item.capability));

  return (
    <div className="min-h-dvh bg-sq-ground">
      <header className="sq-on-brand bg-sq-brand">
        <div className="mx-auto flex min-h-12 max-w-[1200px] flex-wrap items-center justify-between gap-sq-2 px-sq-3">
          <div className="flex flex-wrap items-center gap-sq-3">
            <a href="/company" className="flex items-center gap-2 no-underline">
              <BrandMark size={22} tone="brand" title="" />
              <span className="text-sq-body font-semibold text-white">SmartQuote</span>
              <span className="text-sq-micro font-medium uppercase tracking-wide text-sq-gold">
                licence
              </span>
            </a>
            {items.length > 0 && (
              <nav aria-label="Administration">
                <ul className="flex flex-wrap items-center gap-sq-1">
                  {items.map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        aria-current={current === item.href ? 'page' : undefined}
                        className={[
                          'inline-flex min-h-11 items-center rounded-md px-sq-2 text-sq-body no-underline transition-colors duration-sq-fast',
                          current === item.href
                            ? 'bg-white/15 font-medium text-white'
                            : 'text-white/80 hover:bg-white/10 hover:text-white',
                        ].join(' ')}
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>
          {account}
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] px-sq-3 py-sq-6">{children}</main>
    </div>
  );
}
