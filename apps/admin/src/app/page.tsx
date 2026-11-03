import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { serverFetch } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignInForm } from '@/components/SignInForm';

/**
 * The admin landing route.
 *
 * There is no public content: the vendor's staff sign in, or they see nothing. The redirect
 * runs on the server, so a signed-in person never sees a sign-in form flash past.
 */
export default async function AdminHomePage() {
  const session = await serverFetch<SessionView>('/auth/session');

  // Only a platform role is sent on. A company administrator who happens to hold no platform
  // role would otherwise be redirected to a screen the API refuses, which reads as a broken
  // link rather than as "not your screen".
  if (session.ok && session.data.platformRole !== null) {
    redirect('/company');
  }

  return (
    <ShellFrame>
      <div className="mx-auto flex max-w-sm flex-col gap-sq-4 py-sq-8">
        <div>
          <h1 className="text-sq-title font-semibold">Administration</h1>
          <p className="mt-1 text-sq-body text-sq-ink-muted">
            For the vendor&apos;s own staff: the company, its seats, price books and templates.
          </p>
        </div>
        <SignInForm next="/company" />
      </div>
    </ShellFrame>
  );
}
