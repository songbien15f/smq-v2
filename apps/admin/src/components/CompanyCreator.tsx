'use client';

/**
 * Create a company.
 *
 * ## Why this is a form and not a script
 *
 * The installer existed because a brand-new database has a chicken-and-egg problem: creating a
 * company over HTTP needs a platform capability, and granting one needs an administrator. That
 * problem is solved once per installation. **Every company after the first has a vendor
 * administrator already**, so a form is the honest shape — and the route
 * (`POST /admin/companies`, behind `platform:companies`) has existed all along with no screen
 * reaching it.
 *
 * ## The one-time password is shown once, on purpose
 *
 * The API generates it and stores only a hash. A screen that could show it again would mean
 * storing it again. So it is rendered here, with a copy button, and a note that closing the panel
 * loses it — the fix is "reset the administrator's password", not "look it up".
 *
 * ## Four fields are the sign-in credentials, so they are named as such
 *
 * `code`, the administrator's email, and the username derived from it are what the person types at
 * the client app. The labels say what each one is for, because "slug" and "code" are the two most
 * confusable fields in the product.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Panel } from '@sq/ui';
import { api } from '@/lib/adminApi';

/** What the API answers with on success. */
interface CreatedCompany {
  tenantId: string;
  adminUserId: string;
  adminEmail: string;
  temporaryPassword: string;
}

/** A slug the API will accept, derived from a name. */
function slugFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 62);
}

/** A code from a name: letters and digits, upper-cased, first 10 — what migration 009 derives. */
function codeFrom(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
}

export function CompanyCreator() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<CreatedCompany | null>(null);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [slug, setSlug] = useState('');
  const [seats, setSeats] = useState('5');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminDisplayName, setAdminDisplayName] = useState('');

  function reset(): void {
    setName('');
    setCode('');
    setSlug('');
    setSeats('5');
    setAdminEmail('');
    setAdminDisplayName('');
    setError(null);
    setFieldErrors({});
    setCreated(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const seatCount = Number(seats);
    if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > 500) {
      setBusy(false);
      setError('Seats must be a whole number between 1 and 500.');
      return;
    }

    const result = await api<CreatedCompany>('admin/companies', {
      method: 'POST',
      body: {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        slug: slug.trim() || slugFrom(name),
        seats: seatCount,
        subscriptionEndsAt: null,
        adminEmail: adminEmail.trim(),
        adminDisplayName: adminDisplayName.trim(),
      },
    });

    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      const details: Record<string, string> = {};
      for (const detail of result.details ?? []) details[detail.path] = detail.message;
      setFieldErrors(details);
      const first = result.details?.[0]?.path;
      if (first !== undefined) document.getElementById(first)?.focus();
      return;
    }

    setCreated(result.data);
    // The list behind this panel is a server render; refreshing is what makes the new company
    // appear without a reload.
    router.refresh();
  }

  if (created !== null) {
    const username = created.adminEmail.split('@')[0] ?? 'admin';
    return (
      <Panel title="Company created" description="Give these to the administrator. The password is shown once.">
        <dl className="grid gap-sq-2 text-sq-body sm:grid-cols-2">
          <div>
            <dt className="text-sq-micro text-sq-ink-muted">Company code</dt>
            <dd className="sq-numeric font-semibold">{code.toUpperCase()}</dd>
          </div>
          <div>
            <dt className="text-sq-micro text-sq-ink-muted">Username</dt>
            <dd className="sq-numeric font-semibold">{username}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sq-micro text-sq-ink-muted">One-time password</dt>
            <dd className="mt-1 break-all rounded-md border border-sq-line bg-sq-ground p-sq-2 font-mono text-sq-body">
              {created.temporaryPassword}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sq-micro text-sq-ink-muted">Email on the account</dt>
            <dd>{created.adminEmail}</dd>
          </div>
        </dl>

        <p className="mt-sq-3 text-sq-micro text-sq-ink-muted">
          They sign in at the client app with the company code, the username and that password, and
          are asked to choose a new password immediately. Closing this panel loses the password —
          reset it from the company&apos;s page if that happens.
        </p>

        <div className="mt-sq-3 flex gap-sq-2">
          <Button
            variant="primary"
            onClick={() => {
              void navigator.clipboard?.writeText(created.temporaryPassword);
            }}
          >
            Copy password
          </Button>
          <Button
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Done
          </Button>
        </div>
      </Panel>
    );
  }

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        New company
      </Button>
    );
  }

  return (
    <Panel
      title="New company"
      description="Creates the company and its first administrator in one step."
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-sq-3" noValidate>
        {error !== null && (
          <div
            role="alert"
            className="rounded-md border border-sq-danger/30 bg-sq-danger/10 px-sq-2 py-sq-2 text-sq-body text-sq-danger"
          >
            {error}
          </div>
        )}

        <Field
          id="name"
          label="Company name"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            // Derived until the operator types their own, so a two-field creation stays possible.
            if (code === '') setCode(codeFrom(event.target.value));
            if (slug === '') setSlug(slugFrom(event.target.value));
          }}
          error={fieldErrors.name}
        />

        <div className="grid gap-sq-3 sm:grid-cols-2">
          <Field
            id="code"
            label="Company code"
            required
            hint="Typed at sign-in. Letters, digits, dashes."
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            error={fieldErrors.code}
          />
          <Field
            id="slug"
            label="URL slug"
            required
            hint="Lowercase, for links. Rarely typed."
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            error={fieldErrors.slug}
          />
        </div>

        <Field
          id="seats"
          label="Seats"
          required
          hint="How many people may hold a session at once."
          type="number"
          min="1"
          max="500"
          value={seats}
          onChange={(event) => setSeats(event.target.value)}
          error={fieldErrors.seats}
        />

        <div className="grid gap-sq-3 sm:grid-cols-2">
          <Field
            id="adminEmail"
            label="Administrator email"
            required
            hint="Where quotes are mailed from. Also decides the username."
            type="email"
            autoComplete="off"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            error={fieldErrors.adminEmail}
          />
          <Field
            id="adminDisplayName"
            label="Administrator name"
            required
            value={adminDisplayName}
            onChange={(event) => setAdminDisplayName(event.target.value)}
            error={fieldErrors.adminDisplayName}
          />
        </div>

        <div className="flex gap-sq-2">
          <Button type="submit" variant="primary" loading={busy}>
            Create company
          </Button>
          <Button
            type="button"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}
