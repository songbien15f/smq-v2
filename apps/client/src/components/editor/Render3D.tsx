'use client';

/**
 * The editor's 3D view: a thin shell over `@sq/viewer3d`.
 *
 * Everything that draws, lights, frames and orbits lives in the package now (plan G-f S7), so the
 * public Guest page shows the same model. What stays here is the part that is the editor's own: read
 * the shed store, narrow it to a dimensional building, and show the editor's empty state when there
 * is nothing to draw.
 *
 * **Behaviour is unchanged.** Same props, same empty state, same camera, same on-demand frameloop;
 * `e2e/stepOne.spec.ts` still proves the model draws and the roof can be lifted off. The only change
 * visible to another file in this app is the label on the import.
 */

import { withDimensions } from '@sq/core/domain';
import type { FrameRowLayout } from '@sq/core/domain';
import { useShedStore } from '@/store/useShedStore';
import { ShedViewer } from '@sq/viewer3d';

export { cameraFrameFor } from '@sq/viewer3d';
export type { CameraFrame } from '@sq/viewer3d';

export function Render3D({
  showRoof = true,
  frameRows = null,
  resetView = 0,
}: {
  showRoof?: boolean;
  frameRows?: FrameRowLayout | null;
  /** Bumped by "Reset view": returns the camera to its framing position. */
  resetView?: number;
}) {
  const stored = useShedStore((s) => s.config);
  /*
   * The 3D view draws a building; without dimensions there is nothing to draw. The empty state lives
   * one level up in `PlanView`, which owns the 2D/3D toggle — so this component is only mounted for a
   * described building and narrows rather than rendering a second message.
   */
  const config = withDimensions(stored);

  /*
   * The guard, in the component that owns the canvas.
   *
   * `PlanView` normally decides what to mount, but a direct caller (a test, a future screen) must not
   * be able to hand this component a building with no dimensions — so the absence is handled here
   * too, with the same sentence the 2D view uses.
   */
  if (config === null) {
    return (
      <div className="flex h-full min-h-[280px] w-full flex-col items-center justify-center gap-sq-2 rounded-lg border border-dashed border-sq-line bg-sq-surface p-sq-4 text-center">
        <p className="text-sq-body font-medium text-sq-ink">Nothing to draw yet</p>
        <p className="max-w-sm text-sq-micro text-sq-ink-muted">
          Enter the span, the overall length and the wall height in Quote details — the model is built
          from those three numbers.
        </p>
      </div>
    );
  }

  return (
    <div className="model-canvas" style={{ width: '100%', height: '100%' }}>
      <ShedViewer config={config} showRoof={showRoof} frameRows={frameRows} resetView={resetView} />
    </div>
  );
}
