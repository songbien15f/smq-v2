import type { SessionView } from '@sq/contracts';
import { BrandMark } from '@sq/ui';
import { NavDrawer } from './NavDrawer';
import { NavIcon, type NavIconName } from './NavIcons';
import { SignOutButton } from './SignOutButton';

/**
 * The admin shell: a navy sidebar of grouped screens, a thin white top bar with where you are and who
 * you are, and the page.
 *
 * ## Why a sidebar and not the old header row
 *
 * The header carried the brand, seven links and Sign out in one wrapping row. At a 580px pane it broke
 * into three rows and took a third of the screen, and every screen added since (price-book browsing,
 * members) would have made that worse. A vertical list takes new entries without reflowing, and its
 * groups say what kind of thing each screen is about — customers, prices, the system — which seven
 * peers in a row could not. Below 1024px the same list opens as a drawer from the top bar.
 *
 * ## Why the nav is derived from capabilities
 *
 * A link appears because the session holds the capability the API checks, never because the page
 * guessed — a link that leads to "forbidden" reads as a broken product. A group with nothing left in
 * it is dropped with its heading.
 *
 * ## Why the session is passed in rather than read here
 *
 * This is a server component rendered by each page, and the session is already resolved there. A
 * second `serverFetch` per page for a sidebar would be a second round trip for chrome.
 */

/** One destination, and the capability that makes it reachable (`null`: any platform staff). */
export interface AdminNavItem {
  href: string;
  label: string;
  capability: string | null;
  icon: NavIconName;
}

export interface AdminNavGroup {
  /** `null` for the ungrouped entry at the top. */
  label: string | null;
  items: AdminNavItem[];
}

/** Every screen, grouped and in the order the sidebar presents them. */
export const ADMIN_NAV: AdminNavGroup[] = [
  { label: null, items: [{ href: '/', label: 'Overview', capability: null, icon: 'overview' }] },
  {
    label: 'Customers',
    items: [
      { href: '/company', label: 'Companies', capability: 'platform:companies', icon: 'companies' },
      { href: '/seats', label: 'Seats', capability: 'platform:companies', icon: 'seats' },
      { href: '/enquiries', label: 'Enquiries', capability: 'platform:enquiries', icon: 'enquiries' },
      { href: '/guest-requests', label: 'Guest requests', capability: 'platform:enquiries', icon: 'guestRequests' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { href: '/price-books', label: 'Price books', capability: 'platform:pricebooks', icon: 'priceBooks' },
      { href: '/prices', label: 'Company prices', capability: 'platform:companies', icon: 'companyPrices' },
      { href: '/templates', label: 'Templates', capability: 'platform:templates', icon: 'templates' },
      {
        href: '/guest-types',
        label: 'Guest building types',
        capability: 'platform:templates',
        icon: 'guestTypes',
      },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/usage', label: 'Usage', capability: 'platform:audit', icon: 'usage' },
      { href: '/releases', label: 'Releases', capability: 'platform:versions', icon: 'releases' },
      { href: '/audit', label: 'Audit', capability: 'platform:audit', icon: 'audit' },
    ],
  },
];

const ROLE_LABEL: Record<NonNullable<SessionView['platformRole']>, string> = {
  platform_admin: 'Platform admin',
  platform_support: 'Platform support',
};

function visibleNav(capabilities: readonly string[]): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.capability === null || capabilities.includes(item.capability)),
  })).filter((group) => group.items.length > 0);
}

function Brand() {
  return (
    <a href="/" className="flex items-center gap-2 no-underline">
      <BrandMark size={22} tone="brand" title="" />
      <span className="text-sq-body font-semibold text-white">SmartQuote</span>
      <span className="text-sq-micro font-medium uppercase tracking-wide text-sq-gold">licence</span>
    </a>
  );
}

function SideNav({ groups, current }: { groups: AdminNavGroup[]; current?: string }) {
  return (
    <nav aria-label="Administration" className="flex flex-col gap-sq-4 px-sq-2 pb-sq-4 pt-sq-2">
      {groups.map((group) => (
        <div key={group.label ?? 'top'} className="flex flex-col gap-0.5">
          {group.label !== null && (
            <p className="px-sq-2 pb-1 text-sq-micro font-medium uppercase tracking-wide text-white/60">
              {group.label}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = current === item.href;
              return (
                <li key={item.href}>
                  <a
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={[
                      // The gold bar is the active indicator MASTER asks for on navy chrome; the
                      // weight and background repeat it for anyone who cannot see the colour.
                      'relative flex min-h-10 items-center gap-sq-2 rounded-md px-sq-2 text-sq-body no-underline',
                      'transition-colors duration-sq-fast',
                      active
                        ? 'bg-white/10 font-medium text-white before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-sq-gold'
                        : 'text-white/80 hover:bg-white/5 hover:text-white',
                    ].join(' ')}
                  >
                    <NavIcon name={item.icon} />
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** "Customers › Companies": the group says what kind of screen this is, the link is the way back. */
function Crumb({ current }: { current?: string }) {
  for (const group of ADMIN_NAV) {
    const item = group.items.find((entry) => entry.href === current);
    if (item === undefined) continue;
    return (
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex items-center gap-1.5 truncate text-sq-body">
          {group.label !== null && (
            <li className="hidden text-sq-ink-muted sm:block">
              {group.label}
              <span aria-hidden="true" className="ml-1.5">
                ›
              </span>
            </li>
          )}
          <li>
            <a href={item.href} className="font-medium text-sq-ink no-underline hover:underline">
              {item.label}
            </a>
          </li>
        </ol>
      </nav>
    );
  }
  return null;
}

export function ShellFrame({
  children,
  session,
  current,
}: {
  children: React.ReactNode;
  /** The signed-in platform user. Absent on the sign-in screen, which gets the brand bar only. */
  session?: SessionView;
  /** The current path, so its link reads as current rather than merely present. */
  current?: string;
}) {
  if (session === undefined) {
    return (
      <div className="min-h-dvh bg-sq-ground">
        <header className="sq-on-brand flex h-12 items-center bg-sq-brand px-sq-3">
          <Brand />
        </header>
        <main className="mx-auto max-w-[1200px] px-sq-3 py-sq-6">{children}</main>
      </div>
    );
  }

  const groups = visibleNav(session.capabilities);
  const role = session.platformRole === null ? null : ROLE_LABEL[session.platformRole];

  return (
    <div className="min-h-dvh bg-sq-ground lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sq-on-brand hidden bg-sq-brand lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:overflow-y-auto">
        <div className="flex h-12 shrink-0 items-center px-sq-3">
          <Brand />
        </div>
        <SideNav groups={groups} current={current} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-sq-2 border-b border-sq-line bg-sq-surface px-sq-2 sm:px-sq-3">
          <NavDrawer brand={<Brand />}>
            <SideNav groups={groups} current={current} />
          </NavDrawer>
          <Crumb current={current} />

          <div className="ml-auto flex items-center gap-sq-2">
            <div className="hidden flex-col items-end leading-tight md:flex">
              <span className="text-sq-body font-medium text-sq-ink">{session.displayName}</span>
              {role !== null && <span className="text-sq-micro text-sq-ink-muted">{role}</span>}
            </div>
            <a
              href="/change-password"
              aria-current={current === '/change-password' ? 'page' : undefined}
              className="hidden min-h-10 items-center rounded-md px-sq-2 text-sq-body text-sq-ink-muted no-underline hover:bg-sq-ground hover:text-sq-ink sm:inline-flex"
            >
              Change password
            </a>
            <SignOutButton />
          </div>
        </header>

        <main className="w-full max-w-[1200px] px-sq-3 py-sq-6 sm:px-sq-4">{children}</main>
      </div>
    </div>
  );
}
