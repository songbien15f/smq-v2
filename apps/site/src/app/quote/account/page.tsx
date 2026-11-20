import type { Metadata } from 'next';
import { AccountPage } from '../components/AccountPage';

export const metadata: Metadata = {
  title: 'Your account — Smart Solutions Australia',
  robots: { index: false },
};

/** `/quote/account` — the signed-in guest's profile (docs/specs/guest-accounts.md). */
export default function GuestAccountRoute() {
  return <AccountPage />;
}
