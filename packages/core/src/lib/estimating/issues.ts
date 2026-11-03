/**
 * Turning issues into a status, and a status into customer-facing words.
 *
 * One place decides both. A quote's status is the worst thing known about it:
 * a blocker outranks an assumption, and an assumption outranks a warning. The
 * label is derived from the same decision, so the document cannot claim more
 * certainty than the estimate has.
 *
 * The words matter as much as the arithmetic. Australian buyers read a shed
 * quote as a commitment, and a demo estimate that says "priced" in the internal
 * sense must never read as "certified" on paper. Nothing here says approved,
 * certified or compliant, and the indicative label says exactly what is missing:
 * engineering and the final price.
 */

import type { EstimateIssue, EstimateStatus } from './types';

/** The status a set of issues implies: the worst of them. */
export function classifyEstimate(issues: EstimateIssue[]): EstimateStatus {
  if (issues.some((issue) => issue.severity === 'blocker')) return 'blocked';
  if (issues.some((issue) => issue.severity === 'assumption')) return 'indicative';
  // A warning is something to mention. It does not weaken the number.
  return 'priced';
}

/**
 * The sentence a customer document carries for this status.
 *
 * `blocked` returns an empty string on purpose: a blocked estimate is not a
 * document a customer receives, so there is no label to print. Returning a
 * reassuring string here would invite one to be printed anyway.
 */
export function customerEstimateLabel(status: EstimateStatus): string {
  switch (status) {
    case 'indicative':
      return 'Indicative estimate — subject to engineering and final pricing';
    case 'priced':
      return 'Priced subject to engineering review';
    case 'blocked':
      return '';
  }
}
