import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { currentSession } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { SignInForm } from '@/components/SignInForm';
import { SignOutButton } from '@/components/SignOutButton';

/** The landing route: the workspace when signed in, sign-in when not. */
export default async function HomePage() {
  const session = await currentSession<SessionView>();

  if (session === null) {
    return (
      <ShellFrame>
        <div className="flex min-h-[60dvh] items-center justify-center">
          <SignInForm />
        </div>
      </ShellFrame>
    );
  }

  // A signed-in visitor goes to their quotes. The redirect runs on the server, so the
  // browser never flashes a sign-in form it does not need.
  redirect('/quotes');
}
