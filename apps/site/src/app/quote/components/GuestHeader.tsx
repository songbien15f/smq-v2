'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut, startGuestAccount, useGuestAccount } from '../account';
import { AccountDialog } from './AccountDialog';
import { IconUser } from './icons';

/**
 * The brand site's address (plan G-a P16): the SSA introduction site in `00.smartcoaustralia.com.au`.
 * Set `NEXT_PUBLIC_BRAND_SITE_URL` in `apps/site/.env.local`; unset, the nav is hidden rather than pointing
 * somewhere wrong. The paths under it (`/projects`, `/contact`) are assumed and change here if that
 * site names them differently.
 */
const BRAND = (process.env.NEXT_PUBLIC_BRAND_SITE_URL ?? '').trim().replace(/\/+$/, '');

const NAV = [
  { label: 'Home', path: '/' },
  { label: 'Projects', path: '/projects' },
  { label: 'Contact', path: '/contact' },
] as const;

/**
 * Logo · "Guest session" pill · account (Sign in, or the guest's name and a menu) · brand-site nav
 * at ≥ 1024px (spec "Bố cục", override §4a; docs/specs/guest-accounts.md).
 */
export function GuestHeader() {
  const signedIn = useGuestAccount((s) => s.status === 'signed-in');
  return (
    <header className="g-header">
      <div className="g-container g-header-row">
        {/* Override §4a: the logo links to `/` — the brand site's home once it exists. */}
        <a className="g-logo" href={BRAND === '' ? '/' : `${BRAND}/`}>
          {/* A plain <img>: the file is already sized for the header at 2× (341 × 96). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/ssa-logo-96.png" width={171} height={48} alt="Smart Solutions Australia" />
        </a>
        {/* Signed in, the account button already says who this is. */}
        {signedIn ? null : (
          <p className="g-pill" style={{ margin: 0 }}>
            <IconUser />
            <span className="g-pill-long">Guest session — no sign-up needed</span>
            <span className="g-pill-short">No sign-up needed</span>
          </p>
        )}
        {BRAND === '' ? null : (
          <nav className="g-nav" aria-label="Smart Solutions Australia">
            {NAV.map((item) => (
              <a key={item.label} href={`${BRAND}${item.path}`}>
                {item.label}
              </a>
            ))}
          </nav>
        )}
        <AccountControl />
      </div>
    </header>
  );
}

/** "Sign in", or the signed-in guest's first name opening My profile / Sign out. */
function AccountControl() {
  const status = useGuestAccount((s) => s.status);
  const firstName = useGuestAccount((s) => s.profile?.firstName ?? '');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => startGuestAccount(), []);

  // The menu closes on Esc or a click outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    const onDown = (e: PointerEvent) => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [menuOpen]);

  // Nothing until the first answer, so the header does not flash "Sign in" for a signed-in guest.
  if (status === 'unknown') return <div className="g-account" />;

  if (status === 'signed-out') {
    return (
      <div className="g-account">
        <button type="button" className="g-btn g-btn-outline g-account-btn" onClick={() => setDialogOpen(true)}>
          Sign in
        </button>
        <AccountDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      </div>
    );
  }

  return (
    <div className="g-account" ref={box}>
      <button
        type="button"
        className="g-btn g-btn-outline g-account-btn"
        aria-expanded={menuOpen}
        aria-controls="g-account-menu"
        onClick={() => setMenuOpen((o) => !o)}
      >
        <IconUser />
        <span className="g-account-name">{firstName || 'Account'}</span>
      </button>
      {menuOpen ? (
        <ul id="g-account-menu" className="g-account-menu">
          <li>
            <a href="/quote/account">My profile</a>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void signOut();
              }}
            >
              Sign out
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
