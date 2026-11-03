import { SignInShell } from '@/components/SignInShell';
import { TokenPasswordForm } from '@/components/TokenPasswordForm';

/**
 * Choose a new password from a reset link. The token is in the URL fragment and read by the form,
 * so the server renders nothing but the shell — a fragment never reaches the server at all, which
 * is the point of putting it there.
 */
export default function ResetPage() {
  return (
    <SignInShell>
      <TokenPasswordForm endpoint="auth/reset/confirm" onSuccessRedirect="/quotes" />
    </SignInShell>
  );
}