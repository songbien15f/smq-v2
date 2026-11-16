'use client';

/**
 * Pick the company a page is about — a GET form, so the choice lives in the URL.
 *
 * ## Why a select and not a row of chips
 *
 * The chips showed only the name, and two companies can share a trading name (the demo and the E2E
 * company are both "Demo Sheds Pty Ltd"), so the operator could not tell which one they were editing.
 * A row of chips also stops working past a handful of companies. Every option reads "Name (CODE)",
 * the same label the Templates picker uses, because the code is the one thing that is unique.
 *
 * Choosing an option submits at once. The button stays for a browser running without JavaScript,
 * where the select alone would do nothing.
 */

import { useRef } from 'react';
import { companyLabel } from '@/lib/companyState';

export interface PickerCompany {
  id: string;
  name: string;
  code: string | null;
}

export function CompanyPicker({
  action,
  companies,
  selectedId,
}: {
  action: string;
  companies: PickerCompany[];
  selectedId: string | undefined;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} method="get" action={action} className="flex flex-wrap items-end gap-sq-2">
      <div className="flex min-w-64 flex-col gap-1">
        <label htmlFor="company-picker" className="text-sq-micro font-medium text-sq-ink">
          Company
        </label>
        <select
          id="company-picker"
          name="company"
          defaultValue={selectedId}
          onChange={() => form.current?.requestSubmit()}
          className="min-h-11 w-full cursor-pointer rounded-md border border-sq-line bg-sq-surface px-sq-2 py-sq-1 text-sq-body text-sq-ink"
        >
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {companyLabel(company)}
            </option>
          ))}
        </select>
      </div>
      <noscript>
        <button
          type="submit"
          className="min-h-11 rounded-md border border-sq-line bg-sq-surface px-sq-3 text-sq-body text-sq-ink"
        >
          Show
        </button>
      </noscript>
    </form>
  );
}
