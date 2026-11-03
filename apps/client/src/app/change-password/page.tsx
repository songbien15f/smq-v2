import { redirect } from 'next/navigation';
import type { SessionView } from '@sq/contracts';
import { currentSession } from '@/lib/api';
import { ShellFrame } from '@/components/ShellFrame';
import { ChangePasswordForm } from '@/components/ChangePasswordForm';

/**
 * The forced password change.
 *
 * A company is created with a temporary password that travels through email or a chat
 * window, so it is not a password that may stay in force. The API refuses every other
 * route while the flag is set, which is why this page cannot be skipped by typing a
 * URL: it is the only page the API will serve.
 */
export default async function ChangePasswordPage() {
  const session = await currentSession<SessionView>();
  if (session === null) redirect('/');

  return (
    <ShellFrame
      capabilities={session.capabilities}
      companyName={session.currentTenantName}
    >
      <div className="mx-auto flex max-w-md flex-col gap-sq-3">
        <h1 className="text-sq-title font-semibold">Choose a password</h1>
        <p className="text-sq-body text-sq-ink-muted">
          The password you signed in with was issued by an administrator. Replace it before you start
          quoting — a password that was sent through a message is a password somebody else has seen.
        </p>
        <ChangePasswordForm />
      </div>
    </ShellFrame>
  );
}
