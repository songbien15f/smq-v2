import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { currentSession } from '@/lib/api';
import { SignInShell } from '@/components/SignInShell';
import { SignInForm } from '@/components/SignInForm';

/** The landing route: the workspace when signed in, sign-in when not. */
export default async function HomePage() {
  const session = await currentSession<SessionView>();

  if (session === null) {
    /*
     * The sign-in screen owns its own frame.
     *
     * It is deliberately **not** wrapped in `ShellFrame`: that bar shows a company name and a nav
     * for a workspace, and a person who has not signed in has neither. The two-column shell is the
     * one screen in this app that is not inside the workspace chrome.
     */
    return (
      <SignInShell>
        <SignInForm />
      </SignInShell>
    );
  }

  // A signed-in visitor goes to their quotes. The redirect runs on the server, so the
  // browser never flashes a sign-in form it does not need.
  redirect('/quotes');
}
