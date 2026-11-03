/**
 * Shared test setup for the client app.
 *
 * `jest-dom`'s matchers are the vocabulary a form test wants — `toHaveAttribute`, `toBeDisabled` —
 * and registering them once here keeps every test file from importing them. The React testing
 * library's own cleanup runs automatically when `afterEach` is globally available, which Vitest
 * provides even with `globals: false` for test bodies.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  // A test that replaces `fetch` must not leave it replaced for the next file.
  vi.unstubAllGlobals();
});
