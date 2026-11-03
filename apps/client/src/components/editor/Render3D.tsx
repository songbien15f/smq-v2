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

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useShedStore } from '@/store/useShedStore';
import { DESKTOP_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
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

export function Render3D() {
  const config = useShedStore((s) => s.config);
  // Desktop-only shadows. `false` on the server and on mobile.
  const shadowsEnabled = useMediaQuery(DESKTOP_QUERY);

  return (
    <div className="model-canvas" style={{ width: '100%', height: '100%' }}>
      <Canvas
        shadows={shadowsEnabled}
        dpr={[1, 2]}
        camera={{ position: [CAMERA_DISTANCE, CAMERA_DISTANCE * 0.7, CAMERA_DISTANCE], fov: 45 }}
      >
        <color attach="background" args={['#eef2f5']} />

        <hemisphereLight args={['#ffffff', '#9aa5b1', 1.1]} />
        <directionalLight
          castShadow={shadowsEnabled}
          position={[30, 45, 20]}
          intensity={1.4}
          shadow-mapSize-width={SHADOW_MAP_SIZE}
          shadow-mapSize-height={SHADOW_MAP_SIZE}
        />

        {/* Ground plane and grid, in metres to match the scaled scene. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow={shadowsEnabled}>
          <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
          <meshStandardMaterial color="#cfd8dc" roughness={1} />
        </mesh>
        <gridHelper args={[GRID_SIZE, GRID_DIVISIONS, '#90a4ae', '#c7d0d6']} />

        <Shed3D config={config} />

        <OrbitControls enableDamping makeDefault />
      </Canvas>
    </div>
  );
}
