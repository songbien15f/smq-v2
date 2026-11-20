/**
 * Re-exported from `@sq/viewer3d`, which owns the implementation.
 *
 * It is the layout shell's breakpoint hook (`DESKTOP_QUERY`) as well as the 3D view's, so it lives
 * with the viewer rather than in a second copy that could drift from it.
 */
export { useMediaQuery, DESKTOP_QUERY } from '@sq/viewer3d';
