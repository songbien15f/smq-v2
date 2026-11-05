import { describe, expect, it } from 'vitest';
import { countersFor } from '../routes/send';

/**
 * The send-mode → counter mapping.
 *
 * This is the only new logic the four modes add: which column a given intent increments. It is
 * tested on its own because the route that uses it needs a working SMTP transport, and a test
 * that opened a real connection would be a test of the relay rather than of this mapping.
 */
describe('countersFor', () => {
  it('counts a quote mail against the quote counter', () => {
    expect(countersFor('quote')).toEqual(['quote_send_count']);
  });

  it('counts the two factory intents separately', () => {
    expect(countersFor('engineering')).toEqual(['engineering_send_count']);
    expect(countersFor('manufacturing')).toEqual(['manufacturing_send_count']);
  });

  it('counts "both" as one action for the two factory intents', () => {
    expect(countersFor('both')).toEqual(['engineering_send_count', 'manufacturing_send_count']);
  });

  it('never names a column outside the three the migration adds', () => {
    const allowed = new Set(['quote_send_count', 'engineering_send_count', 'manufacturing_send_count']);
    for (const column of [...countersFor('quote'), ...countersFor('engineering'), ...countersFor('manufacturing'), ...countersFor('both')]) {
      expect(allowed.has(column)).toBe(true);
    }
  });
});
