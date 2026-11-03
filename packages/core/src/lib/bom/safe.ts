/**
 * Call a lookup member, treating a missing or throwing member as "no price".
 *
 * The BOM is built from whatever lookup it is given, and a caller may pass a
 * partial one — a test fixture, or a price book imported from a dump that did not
 * contain every table. A missing member must produce a mocked line, not a
 * `TypeError` that takes the whole quote down with it.
 */
export function safeCall<T>(fn: (() => T) | undefined): T | undefined {
  if (typeof fn !== 'function') return undefined;
  try {
    return fn();
  } catch {
    return undefined;
  }
}
