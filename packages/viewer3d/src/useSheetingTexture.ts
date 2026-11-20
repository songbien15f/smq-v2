'use client';

/**
 * Procedural sheeting texture, shared by the editor's 3D view and the demo.
 *
 * No image asset: a rib is a gradient, not art, and a bitmap would have to be shipped and kept in
 * step with the sheet cover the price book states.
 *
 * `ExtrudeGeometry` passes shape coordinates straight through as **millimetre** UVs, so `repeat` is
 * set to `1 / RIB_PITCH`: exactly one rib per 762 mm, which is the Corro roof's own cover. The
 * contrast is deliberately tiny — a few percent either way — because it has to read as painted steel
 * at 20 m. A texture that is subtly wrong is invisible; one that is loudly wrong is not.
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/** Sheet cover for a Corro roof, mm — the pitch of one rib. */
export const RIB_PITCH = 762;

function buildRibTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 4;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  if (context === null) return texture;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 64, 4);

  const gradient = context.createLinearGradient(0, 0, 64, 0);
  gradient.addColorStop(0.0, 'rgba(0, 0, 0, 0.00)');
  gradient.addColorStop(0.15, 'rgba(0, 0, 0, 0.10)');
  gradient.addColorStop(0.28, 'rgba(255, 255, 255, 0.12)');
  gradient.addColorStop(0.42, 'rgba(0, 0, 0, 0.03)');
  gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0.00)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 4);

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / RIB_PITCH, 1);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The rib texture, built once per mount and disposed with it.
 *
 * A canvas needs a `document`, so this must run in the browser: it is called from a `'use client'`
 * component that only mounts behind a WebGL canvas.
 */
export function useSheetingTexture(): THREE.CanvasTexture {
  const texture = useMemo(() => buildRibTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}
