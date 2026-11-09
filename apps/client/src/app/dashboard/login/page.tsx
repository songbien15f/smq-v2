import { redirect } from 'next/navigation';
import { hasVendorSession } from '@/lib/vendorGuard';
import { vendorPassword } from '@/lib/vendorUsage';
import { VendorLoginForm } from '@/components/vendor/VendorLoginForm';

/**
 * The dashboard's sign-in: one field, one password.
 *
 * Deliberately outside the product's shell — no rail, no company name, no quote list. This page is
 * not a workspace; it is the operator checking whether the product is being used, and showing him
 * the chrome of a customer's session would suggest he is inside one.
 */
export const dynamic = 'force-dynamic';

export default async function VendorLoginPage() {
  const configured = vendorPassword() !== null;

  // Already signed in: no reason to show the form again.
  if (configured && (await hasVendorSession())) redirect('/dashboard');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-sq-4 px-sq-4">
      <div>
        <h1 className="text-sq-title font-semibold text-sq-ink">Usage dashboard</h1>
        <p className="mt-sq-1 text-sq-body text-sq-ink-muted">
          {configured
            ? 'One password. This page reads every company’s activity, so it is not part of any company’s sign-in.'
            : 'This deployment has no dashboard password set (VENDOR_DASHBOARD_PASSWORD), so the dashboard is closed.'}
        </p>
      </div>

      {configured ? (
        <VendorLoginForm />
      ) : (
        <p className="rounded-md border border-sq-attention/30 bg-sq-attention/5 p-sq-3 text-sq-body text-sq-ink">
          Set <code>VENDOR_DASHBOARD_PASSWORD</code> in the API and client environment, then restart both.
          An unset password closes this page rather than opening it — a missing configuration must never
          mean “no password required”.
        </p>
      )}
    </main>
  );
}
