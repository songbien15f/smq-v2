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

import { useEffect, useRef, useState } from 'react';
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

/**
 * The container's size, measured the way `Render2D` measures its own.
 *
 * **Why this is not left to `<Canvas>`.** R3F sizes its canvas from `react-use-measure`, which reads
 * `getBoundingClientRect` only when `ResizeObserver` tells it to — and `ResizeObserver` is not always
 * delivered. Measured here in an embedded pane: a plain observed `<div>` never fired, so the canvas
 * stayed at the HTML default of **300 × 150** while its container was 655 × 839. The 2D canvas beside
 * it was always right, because `Render2D` reads `clientWidth`/`clientHeight` directly.
 *
 * `react-use-measure` also listens on `window` for `resize` — its own escape hatch for exactly this
 * — so one dispatched event after layout is enough to make R3F take a reading. That is a smaller and
 * more honest fix than re-implementing R3F's sizing: nothing here duplicates its renderer.
 */
function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const measure = (): void => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize((current) => (current.width === next.width && current.height === next.height ? current : next));
      // Tell R3F to re-read. Harmless if it already knows; essential if no observer fired.
      window.dispatchEvent(new Event('resize'));
    };

    measure();
    // One more after the first paint, in case the container had no height when this effect ran.
    const timer = setTimeout(measure, 0);

    if (typeof ResizeObserver === 'undefined') return () => clearTimeout(timer);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [ref]);

  return size;
}

export function Render3D() {
  const config = useShedStore((s) => s.config);
  // Desktop-only shadows. `false` on the server and on mobile.
  const shadowsEnabled = useMediaQuery(DESKTOP_QUERY);

  const containerRef = useRef<HTMLDivElement | null>(null);
  useContainerSize(containerRef);

  return (
    <div ref={containerRef} className="model-canvas" style={{ width: '100%', height: '100%' }}>
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
