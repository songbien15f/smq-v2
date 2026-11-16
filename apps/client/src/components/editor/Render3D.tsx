'use client';

/**
 * The 3D model view.
 *
 * An R3F `<Canvas>` holding `Shed3D`, lit by a generated studio environment, a hemisphere fill, a
 * shadow-casting key light and a cool fill — the same rig the `/demo` page uses, because a demo that
 * looks better than the product is a demo of something else.
 *
 * ## The camera frames the building, not the origin
 *
 * The shed's own coordinates start at a corner: `(0, 0, 0)` is the front-left floor point, and the
 * building extends to `(span, height, length)`. Aiming a camera at the origin therefore points it at
 * one corner with the whole shed off to the side, which is what made it hard to orbit. Everything
 * below is derived from the building's centre, and the orbit target is that centre.
 *
 * ## Shadows are a desktop affordance
 *
 * `shadows` on the Canvas, the key light's `castShadow`, the ground's `receiveShadow` and the shadow
 * map are all gated on the same `useMediaQuery` result, so a phone neither pays for the shadow pass
 * nor allocates the map. The shadow camera is sized to the **building** — the default frustum is
 * ±5 m, which clips a 24 m shed and renders its shadow as a broken block.
 *
 * ## Rendering on demand
 *
 * `frameloop="demand"`: a still scene costs nothing. `OrbitControls` invalidates while it moves and
 * while its damping settles, so dragging still animates and parking the camera stops the GPU.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { withDimensions } from '@sq/core/domain';
import type { FrameRowLayout, DimensionedShed } from '@sq/core/domain';
import { useShedStore } from '@/store/useShedStore';
import { DESKTOP_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { useContainerSize } from '@/hooks/useContainerSize';
import { StudioEnvironment } from '@/components/three/StudioEnvironment';
import { Shed3D } from './Shed3D';

/** Field of view, degrees. Narrower than the default so a long shed does not fisheye. */
const FOV = 40;
/** Breathing room around the building, as a fraction of its bounding sphere. */
const FIT_MARGIN = 1.12;
/** Ground plane extent, metres. */
const GROUND_SIZE = 240;
/** Shadow map resolution used only on desktop, where shadows are enabled. */
const SHADOW_MAP_SIZE = 2048;

/** The camera's frame: where to look and where to stand, in metres. */
export interface CameraFrame {
  target: [number, number, number];
  position: [number, number, number];
  /** The building's longest horizontal side, metres — used to size limits and the shadow camera. */
  extent: number;
}

/**
 * Where the camera should stand to frame `shed`, for a canvas of `aspect` (width / height).
 *
 * ## Why the aspect is an argument
 *
 * The editor's 3D pane is **taller than it is wide** (measured 535 × 608). A perspective camera's
 * horizontal half-angle is `atan(tan(fov/2) × aspect)`, so with `aspect < 1` the horizontal direction
 * is the tighter one — and a distance computed from the vertical angle alone lets a 24 m shed run off
 * both sides. It did: measured, the building touched both canvas edges.
 *
 * So the distance comes from the **bounding sphere** and the **smaller** of the two half-angles. A
 * sphere rather than a box because the camera orbits: a distance that fits an axis-aligned box at one
 * angle clips it at another, and the operator should not have to zoom out after every drag.
 *
 * The target is the building's centre at a third of its height — low enough to see the roof from the
 * side rather than from above, high enough that the eaves are not edge-on.
 */
export function cameraFrameFor(shed: DimensionedShed, aspect = 1): CameraFrame {
  const spanM = shed.span / 1000;
  const lengthM = shed.length / 1000;
  const heightM = shed.height / 1000;
  const extent = Math.max(spanM, lengthM);

  // Half the diagonal of the building's bounding box: the radius the camera has to clear.
  const radius = Math.hypot(spanM, heightM, lengthM) / 2;
  const halfV = (FOV * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(0.2, aspect));
  const halfAngle = Math.min(halfV, halfH);
  const distance = (radius / Math.sin(halfAngle)) * FIT_MARGIN;

  return {
    target: [spanM / 2, heightM / 3, lengthM / 2],
    // A three-quarter view: equal x and z offsets, lifted so the roof is visible.
    position: [spanM / 2 + distance * 0.62, heightM + distance * 0.5, lengthM / 2 + distance * 0.62],
    extent,
  };
}

/** The controller drei's `OrbitControls` exposes through its ref (its own class, imported by drei). */
type OrbitControlsHandle = React.ComponentRef<typeof OrbitControls>;

/**
 * Point the camera at `frame`, and re-point it whenever the building changes size.
 *
 * Runs as an effect rather than through `<Canvas camera>` props because the frame depends on the
 * building, which arrives after mount and changes as the operator types a dimension. The controls are
 * updated too: without that, "orbit" would swing around the old target and the building would slide
 * out of view.
 */
function FrameCamera({
  frame,
  controls,
}: {
  frame: CameraFrame;
  controls: React.RefObject<OrbitControlsHandle | null>;
}) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    camera.position.set(...frame.position);
    const target = new THREE.Vector3(...frame.target);
    camera.lookAt(target);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = FOV;
      camera.updateProjectionMatrix();
    }
    if (controls.current !== null) {
      controls.current.target.copy(target);
      controls.current.update();
    }
    invalidate();
  }, [camera, frame, controls, invalidate]);

  return null;
}

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
  // Desktop-only shadows. `false` on the server and on mobile.
  const shadowsEnabled = useMediaQuery(DESKTOP_QUERY);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<OrbitControlsHandle | null>(null);
  const size = useContainerSize(containerRef);

  /*
   * The frame, memoised on the three dimensions **and the canvas aspect**: a new object per render
   * would re-aim the camera on every keystroke elsewhere on the screen and fight the operator's own
   * orbiting, but a narrow pane needs a different distance from a wide one for the same building.
   */
  const aspect = size.height > 0 ? size.width / size.height : 1;
  const frame = useMemo(
    () => (config === null ? null : cameraFrameFor(config, aspect)),
    [config?.span, config?.length, config?.height, aspect],
  );

  /*
   * The guard, in the component that owns the canvas.
   *
   * `PlanView` normally decides what to mount, but a direct caller (a test, a future screen) must not
   * be able to hand this component a building with no dimensions — so the absence is handled here
   * too, with the same sentence the 2D view uses.
   */
  if (config === null || frame === null) {
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

  /*
   * Framing numbers in metres: the shed's own units, because the scene group scales millimetres by
   * 1/1000 and the camera lives in that scaled world.
   */
  const spanM = config.span / 1000;
  const lengthM = config.length / 1000;
  const heightM = config.height / 1000;
  const centre: [number, number, number] = [spanM / 2, 0, lengthM / 2];
  const shadowHalf = frame.extent / 2 + 6;

  return (
    <div ref={containerRef} className="model-canvas" style={{ width: '100%', height: '100%' }}>
      <Canvas
        shadows={shadowsEnabled}
        dpr={[1, 2]}
        /*
         * Render on demand: a still scene costs nothing. `OrbitControls` invalidates while it moves
         * and while damping settles, so dragging still animates and parking the camera stops the GPU.
         */
        frameloop="demand"
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
        camera={{ position: frame.position, fov: FOV, near: 0.5, far: 600 }}
      >
        <color attach="background" args={['#eef2f5']} />

        {/* Generated in the browser — no HDR file, no CDN call. Metals need something to reflect. */}
        <StudioEnvironment />

        <hemisphereLight args={['#dcefff', '#b7a992', 0.55]} />
        <directionalLight
          castShadow={shadowsEnabled}
          position={[centre[0] + 26, 34, centre[2] + 16]}
          intensity={2.4}
          shadow-mapSize-width={SHADOW_MAP_SIZE}
          shadow-mapSize-height={SHADOW_MAP_SIZE}
          /*
           * Sized to the building. Three's default orthographic shadow camera is ±5 m, so a 24 m shed
           * had most of itself outside the frustum and its shadow broke into blocks — the single
           * biggest visual difference from the demo.
           */
          shadow-camera-left={-shadowHalf}
          shadow-camera-right={shadowHalf}
          shadow-camera-top={shadowHalf}
          shadow-camera-bottom={-shadowHalf}
          shadow-camera-near={1}
          shadow-camera-far={shadowHalf * 4 + 40}
          shadow-bias={-0.0004}
          shadow-normalBias={0.03}
        />
        <directionalLight
          position={[centre[0] - 22, 18, centre[2] - 14]}
          intensity={0.55}
          color="#dbe7f0"
        />

        {/*
          Ground and grid under the building, not under the origin. A plane at (0, 0, 0) sits in the
          building's corner and runs off in one direction, which reads as a tilted error.
        */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centre[0], -0.06, centre[2]]} receiveShadow={shadowsEnabled}>
          <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
          <meshStandardMaterial color="#bdb7ab" roughness={1} metalness={0} />
        </mesh>
        <gridHelper
          args={[frame.extent * 3, Math.max(12, Math.round(frame.extent * 3 / 2)), '#a9a396', '#cfc9bd']}
          position={[centre[0], -0.05, centre[2]]}
        />

        <Shed3D config={config} showRoof={showRoof} frameRows={frameRows} />

        {/*
          `resetView` is in the key, so pressing "Reset view" re-mounts the framing component and
          re-aims the camera even when the building has not changed. The camera is not React state —
          `OrbitControls` writes straight to it every frame — so a prop is how a "go home" request has
          to arrive.
        */}
        <FrameCamera key={resetView} frame={frame} controls={controlsRef} />
        {/*
          Orbit limits, from the demo. Without them the camera could swing under the floor or zoom to
          infinity, which is how a person loses the building and has no way back.
        */}
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.08}
          target={frame.target}
          minDistance={Math.max(4, frame.extent * 0.35)}
          maxDistance={frame.extent * 4}
          maxPolarAngle={Math.PI / 2 - 0.02}
        />
      </Canvas>
    </div>
  );
}
