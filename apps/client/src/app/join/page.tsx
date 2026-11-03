import { SignInShell } from '@/components/SignInShell';
import { TokenPasswordForm } from '@/components/TokenPasswordForm';

/**
 * Accept an invitation: choose a password for the first time, and arrive signed in.
 *
 * There is deliberately no "join someone else's company" prompt, because the token already says
 * which company — a person picking a company here would be a person re-opening the door the
 * invitation just closed.
 */
export default function JoinPage() {
  return (
    <SignInShell>
      <TokenPasswordForm endpoint="auth/join/confirm" onSuccessRedirect="/quotes" />
    </SignInShell>
  );
}