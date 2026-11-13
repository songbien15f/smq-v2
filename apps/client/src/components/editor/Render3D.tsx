'use client';

/**
 * The 3D model view.
 *
 * An R3F `<Canvas>` holding `Shed3D`, lit by a hemisphere fill and a directional key light, over a
 * ground plane with a grid. `<OrbitControls enableDamping makeDefault />` supplies touch orbit and
 * pinch-zoom.
 *
 * Shadows are a desktop-only affordance: `shadows` on the Canvas, the key light's `castShadow`, the
 * ground's `receiveShadow`, and the shadow map are all gated on the same `useMediaQuery` result, so a
 * phone neither pays for the shadow pass nor allocates the map.
 *
 * Geometry lives in `Shed3D` (built from `buildWallGeometries` in the domain); this component only
 * sizes the canvas, positions the camera, and owns the lights and controls.
 */

import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { withDimensions } from '@sq/core/domain';
import type { FrameRowLayout } from '@sq/core/domain';
import { useShedStore } from '@/store/useShedStore';
import { DESKTOP_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { useContainerSize } from '@/hooks/useContainerSize';
import { StudioEnvironment } from '@/components/three/StudioEnvironment';
import { Shed3D } from './Shed3D';

/** Camera distance from the shed centre, metres. */
const CAMERA_DISTANCE = 34;
/** Ground plane extent, metres. */
const GROUND_SIZE = 120;
/** Ground grid spacing, metres. */
const GRID_SIZE = 60;
const GRID_DIVISIONS = 60;
/** Shadow map resolution used only on desktop, where shadows are enabled. */
const SHADOW_MAP_SIZE = 2048;

export function Render3D({
  showRoof = true,
  frameRows = null,
}: {
  showRoof?: boolean;
  frameRows?: FrameRowLayout | null;
}) {
  const stored = useShedStore((s) => s.config);
  /*
   * The 3D view draws a building; without dimensions there is nothing to draw. The empty state lives
   * one level up in `PlanView`, which owns the 2D/3D toggle — so this component is only mounted for a
   * described building and narrows rather than rendering a second message.
   */
  const config = withDimensions(stored);
  // Desktop-only shadows. `false` on the server and on mobile.
  const shadowsEnabled = useMediaQuery(DESKTOP_QUERY);

  const containerRef = useRef<HTMLDivElement | null>(null);
  useContainerSize(containerRef);

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
    <div ref={containerRef} className="model-canvas" style={{ width: '100%', height: '100%' }}>
      <Canvas
        shadows={shadowsEnabled}
        dpr={[1, 2]}
        /*
         * Physical tone mapping and antialiasing: the difference between a diagram and a picture.
         * `ACESFilmic` keeps a bright sheet from clipping to flat white, which is what makes painted
         * steel read as steel rather than as a coloured shape.
         */
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        camera={{ position: [CAMERA_DISTANCE, CAMERA_DISTANCE * 0.7, CAMERA_DISTANCE], fov: 45 }}
      >
        <color attach="background" args={['#eef2f5']} />

        {/* Generated in the browser — no HDR file, no CDN call. Metals need something to reflect. */}
        <StudioEnvironment />

        <hemisphereLight args={['#dcefff', '#b7a992', 0.55]} />
        <directionalLight
          castShadow={shadowsEnabled}
          position={[30, 45, 20]}
          intensity={2.1}
          shadow-mapSize-width={SHADOW_MAP_SIZE}
          shadow-mapSize-height={SHADOW_MAP_SIZE}
          shadow-bias={-0.0004}
          shadow-normalBias={0.03}
        />
        <directionalLight position={[-24, 20, -16]} intensity={0.45} color="#dbe7f0" />

        {/* Ground plane and grid, in metres to match the scaled scene. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow={shadowsEnabled}>
          <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
          <meshStandardMaterial color="#cfd8dc" roughness={1} />
        </mesh>
        <gridHelper args={[GRID_SIZE, GRID_DIVISIONS, '#90a4ae', '#c7d0d6']} />

        <Shed3D config={config} showRoof={showRoof} frameRows={frameRows} />

        <OrbitControls enableDamping makeDefault />
      </Canvas>
    </div>
  );
}
