import { SignInShell } from '@/components/SignInShell';
import { ForgotPasswordForm } from '@/components/ForgotPasswordForm';

/**
 * Ask for a link to choose a new password. Public, and it must stay so — the person who lands here
 * has, by definition, not signed in.
 *
 * The form itself is a client component (it reads `window.location` for its own focus behaviour and
 * posts over fetch); the shell is server-rendered. There is no session check, unlike the workspace
 * pages, because there must be no page a signed-in person cannot reach and no sign-in a signed-out
 * person is blocked from.
 */
export default function ForgotPage() {
  return (
    <SignInShell>
      <ForgotPasswordForm />
    </SignInShell>
  );
}