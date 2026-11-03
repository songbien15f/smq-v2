/// <reference types="@testing-library/jest-dom/vitest" />

/**
 * `jest-dom`'s matcher types, for the test files only.
 *
 * The library registers `toHaveAttribute` and friends on Vitest's `expect` at runtime from
 * `vitest.setup.ts`; TypeScript needs telling separately, and the entry point that declares them
 * against **Vitest's** `Assertion` is `/vitest` — the package root declares them against Jest's.
 *
 * Kept in `src/__tests__` rather than the app's `tsconfig.json` so production code cannot call a
 * matcher that only exists in a test run.
 */
