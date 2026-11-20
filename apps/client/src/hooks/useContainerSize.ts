/**
 * Re-exported from `@sq/viewer3d`, which now owns the implementation.
 *
 * The hook exists because R3F's own sizing relies on `ResizeObserver`, which is not always delivered
 * — see the original note in the package. It is needed by the quote editor's 3D view and the `/demo`
 * page, both of which are the package's callers now, so a second copy here would be a second thing
 * to keep right.
 */
export { useContainerSize } from '@sq/viewer3d';
