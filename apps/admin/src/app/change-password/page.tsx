import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignOutButton } from '@/components/SignOutButton';
import { ChangePasswordForm } from '@/components/ChangePasswordForm';

/**
 * Choosing a password.
 *
 * The sign-in form sends a platform administrator here when the session says the password must be
 * changed, and the route did not exist — so a freshly provisioned administrator hit a 404 on their
 * first sign-in and could never replace the temporary password.
 */
export default async function ChangePasswordPage() {
  const session = await serverFetch<SessionView>('/auth/session');
  if (!session.ok) redirect('/');

  return (
    <ShellFrame account={<SignOutButton />} capabilities={session.data.capabilities}>
      <div className="flex flex-col gap-sq-4">
        <div>
          <h1 className="text-sq-title font-semibold">Choose a password</h1>
          <p className="text-sq-body text-sq-ink-muted">
            The password you signed in with was issued to you. Replace it before you continue.
          </p>
        </div>
        <ChangePasswordForm />
      </div>
    </ShellFrame>
  );
}
