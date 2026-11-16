import type { CompanyRow } from '@sq/contracts';
import type { StatusTone } from '@sq/ui';

/**
 * One company's state, as the operator reads it.
 *
 * The list, the detail page and the filter all ask the same question — "is this company fine?" — and
 * they used to answer it inline, each with its own copy of the comparisons. A company is in one state
 * only, chosen in this order: suspended beats everything (nobody can sign in, so seats and dates are
 * moot), then a full house, then an ended subscription.
 */
export type CompanyStateKey = 'suspended' | 'full' | 'ended' | 'active';

export interface CompanyState {
  key: CompanyStateKey;
  tone: StatusTone;
  label: string;
  /** Active, but something a vendor would want to act on: out of seats or past its end date. */
  needsAttention: boolean;
}

export function companyState(company: CompanyRow, now: number = Date.now()): CompanyState {
  if (company.status === 'suspended') {
    return { key: 'suspended', tone: 'danger', label: 'Suspended', needsAttention: false };
  }
  if (company.seatsInUse >= company.seats) {
    return { key: 'full', tone: 'attention', label: 'Every seat in use', needsAttention: true };
  }
  if (company.subscriptionEndsAt !== null && Date.parse(company.subscriptionEndsAt) < now) {
    return { key: 'ended', tone: 'attention', label: 'Subscription ended', needsAttention: true };
  }
  return { key: 'active', tone: 'ok', label: 'Active', needsAttention: false };
}

/** The directory's filter. Lives here, not in the table, because the server page parses it from the URL. */
export type CompanyFilter = 'all' | 'attention' | 'active' | 'suspended';

export const COMPANY_FILTERS: { key: CompanyFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'active', label: 'Active' },
  { key: 'suspended', label: 'Suspended' },
];

export function isCompanyFilter(value: unknown): value is CompanyFilter {
  return COMPANY_FILTERS.some((filter) => filter.key === value);
}

export function matchesCompanyFilter(company: CompanyRow, filter: CompanyFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'suspended') return company.status === 'suspended';
  if (filter === 'active') return company.status === 'active';
  return companyState(company).needsAttention;
}

/**
 * "Name (CODE)" — how a company is named in every picker. Two companies can share a trading name;
 * the code is unique, so it is what tells them apart.
 */
export function companyLabel(company: { name: string; code: string | null }): string {
  return company.code === null ? company.name : `${company.name} (${company.code})`;
}
