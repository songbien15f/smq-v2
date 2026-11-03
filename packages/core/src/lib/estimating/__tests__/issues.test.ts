import { describe, it, expect } from 'vitest';
import { classifyEstimate, customerEstimateLabel } from '@/lib/estimating/issues';
import type { EstimateIssue } from '@/lib/estimating/types';

const issue = (severity: EstimateIssue['severity'], code = 'X'): EstimateIssue => ({
  code,
  severity,
  message: 'Something the operator must see',
});

describe('classifyEstimate', () => {
  it('calls an estimate with no issues priced', () => {
    expect(classifyEstimate([])).toBe('priced');
  });

  it('calls an estimate with an assumption indicative', () => {
    expect(classifyEstimate([issue('assumption', 'FRAME_ASSUMED')])).toBe('indicative');
  });

  it('calls an estimate with a blocker blocked', () => {
    expect(classifyEstimate([issue('blocker', 'MISSING_PRICE')])).toBe('blocked');
  });

  it('lets a blocker outrank an assumption and a warning', () => {
    expect(classifyEstimate([issue('warning'), issue('assumption'), issue('blocker')])).toBe(
      'blocked',
    );
  });

  it('does not treat a warning alone as indicative', () => {
    // A warning is something to mention, not something that weakens the number.
    expect(classifyEstimate([issue('warning')])).toBe('priced');
  });
});

describe('customerEstimateLabel', () => {
  it('states the caveat in full for an indicative estimate', () => {
    expect(customerEstimateLabel('indicative')).toBe(
      'Indicative estimate — subject to engineering and final pricing',
    );
  });

  it('never claims certification, approval or ShedSafe compliance', () => {
    for (const status of ['priced', 'indicative', 'blocked'] as const) {
      expect(customerEstimateLabel(status)).not.toMatch(
        /certified|approved|ShedSafe compliant|engineer-certified/i,
      );
    }
  });

  it('has no customer label for a blocked estimate', () => {
    // A blocked estimate is not a document a customer receives at all.
    expect(customerEstimateLabel('blocked')).toBe('');
  });
});
