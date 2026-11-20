'use client';

/**
 * `@sq/viewer3d` — the building model, in three dimensions.
 *
 * One renderer for both products: the staff quote editor (`apps/client`) and the public Guest page
 * (`apps/site`). The plan (G-f S7) required that separating it **not** change the editor: the
 * editor's `Render3D` still reads its own store and hands the result to `ShedViewer` here, and
 * `e2e/stepOne.spec.ts` still proves the model draws and the roof can be lifted off.
 *
 * Every geometry decision lives in `@sq/core/domain` (`structureParts`, `openingParts`,
 * `buildWallGeometries`). This package places those parts and shades them; it invents no building
 * shape of its own, which is what keeps the drawing and the bill describing one building.
 */

export { ShedViewer, cameraFrameFor, Shed3D, AnyPart } from './ShedViewer';
export { buildWallShape, buildOptionMeshes } from './Shed3D';
export type { OptionMesh } from './Shed3D';
export type { ShedViewerProps, CameraFrame } from './ShedViewer';
export { useContainerSize } from './useContainerSize';
export { useMediaQuery, DESKTOP_QUERY } from './useMediaQuery';
export { useSheetingTexture } from './useSheetingTexture';
export { StudioEnvironment } from './StudioEnvironment';
