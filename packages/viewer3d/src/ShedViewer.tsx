'use client';

/**
 * A building, in three dimensions, ready to drop into any page.
 *
 * This is the pure half of what used to be `apps/client/.../Render3D.tsx`: it takes a
 * `DimensionedShed` and draws it. It knows nothing about the editor's store, its tabs or its
 * Tailwind — which is what lets the public Guest page use the same model as the staff editor
 * (plan G-f S7).
 *
 * ## The camera frames the building, not the origin
 *
 * The shed's coordinates start at a corner: `(0,0,0)` is the front-left floor point. Aiming at the
 * origin points the camera at one corner with the shed off to the side, so everything below is
 * derived from the building's centre (see `cameraFrameFor`).
 *
 * ## Rendering on demand
 *
 * `frameloop="demand"`: a still scene costs nothing. `OrbitControls` invalidates while it moves and
 * while its damping settles, so dragging still animates and parking the camera stops the GPU. A
 * continuously-redrawing canvas measured ~54 000 draw calls in two idle seconds; this is 0.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { DimensionedShed, FrameRowLayout } from '@sq/core/domain';
import { cameraFrameFor, FOV, GROUND_SIZE, SHADOW_MAP_SIZE, type CameraFrame } from './camera';
import { Shed3D } from './Shed3D';
import { StudioEnvironment } from './StudioEnvironment';
import { useContainerSize } from './useContainerSize';
import { DESKTOP_QUERY, useMediaQuery } from './useMediaQuery';

/** The controller drei's `OrbitControls` exposes through its ref (its own class, imported by drei). */
type OrbitControlsHandle = React.ComponentRef<typeof OrbitControls>;

/**
 * Point the camera at `frame`, and re-point it whenever the building changes size.
 *
 * Runs as an effect rather than through `<Canvas camera>` props because the frame depends on the
 * building, which arrives after mount and changes as a dimension is typed. The controls are updated
 * too: without that, "orbit" would swing around the old target and the building would slide out of
 * view.
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

/**
 * A fixed camera, for the screenshot script only (`scripts/qa-guest-shots.mjs`).
 *
 * ## Why it is in the shipped bundle at all
 *
 * The bug it has to photograph is a few centimetres wide and only visible from a chosen angle: a rafter
 * end 300 mm past the wall, a downpipe 180 mm off it. Aiming OrbitControls by dragging a mouse cannot be
 * repeated exactly twice — before the fix and after it — so the coordinates have to be scriptable.
 *
 * ## Why it is harmless in production
 *
 * The whole effect is behind a `NODE_ENV` test, which the bundler replaces at build time, so the body is
 * dead code in a production build and `window.__sqQaCamera` is never defined. It sets nothing on the
 * scene: it moves the same camera and the same controls a drag would, then asks for one frame
 * (`frameloop="demand"` means nothing redraws on its own).
 *
 * Units are **metres**, the scene's own: x across the span (0 = outside face of the left wall), y up,
 * z along the length (0 = the front end).
 */
function QaCamera({ controls }: { controls: React.RefObject<OrbitControlsHandle | null> }) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return undefined;
    const host = window as unknown as {
      __sqQaCamera?: (position: [number, number, number], target: [number, number, number]) => void;
    };
    host.__sqQaCamera = (position, target) => {
      camera.position.set(position[0], position[1], position[2]);
      const aim = new THREE.Vector3(target[0], target[1], target[2]);
      camera.lookAt(aim);
      if (camera instanceof THREE.PerspectiveCamera) camera.updateProjectionMatrix();
      if (controls.current !== null) {
        controls.current.target.copy(aim);
        controls.current.update();
      }
      invalidate();
    };
    return () => {
      delete host.__sqQaCamera;
    };
  }, [camera, controls, invalidate]);

  return null;
}

export interface ShedViewerProps {
  /** The building, in millimetres. `withDimensions()` narrows a stored `ShedConfig` to this. */
  config: DimensionedShed;
  /** Hide the roof (and its trim) to look inside. Walls, frame and openings stay. */
  showRoof?: boolean;
  /**
   * Purlin and girt rows from the last evaluation, or `null` before there is one.
   *
   * They come from the price book's span table, which a browser never sees, so before an evaluation
   * there is nothing honest to draw and no purlin appears. Columns and rafters are at the bay lines
   * either way.
   */
  frameRows?: FrameRowLayout | null;
  /**
   * Shadows, or `undefined` to decide from the screen: on for a desktop-sized viewport, off on a
   * phone, which then neither pays for the shadow pass nor allocates the map.
   */
  shadows?: boolean;
  /** Bumped by a "Reset view" button: returns the camera to its framing position. */
  resetView?: number;
  /** Canvas aspect ratio is inferred from the container; this is the fallback before it is measured. */
  fallbackAspect?: number;
  /** Class for the wrapper element. The caller owns sizing; the canvas fills it. */
  className?: string;
}

export function ShedViewer({
  config,
  showRoof = true,
  frameRows = null,
  shadows,
  resetView = 0,
  fallbackAspect = 1,
  className,
}: ShedViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<OrbitControlsHandle | null>(null);
  const size = useContainerSize(containerRef);
  /*
   * Shadows are a desktop affordance: a phone then neither pays for the shadow pass nor allocates
   * the map. `useMediaQuery` answers `false` on the server, so hydration matches. It is called
   * unconditionally and only *used* when the caller passes no explicit answer — a hook behind `??`
   * would run on some renders and not others.
   */
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const shadowsEnabled = shadows ?? desktop;

  /*
   * The frame is memoised on the three dimensions **and the canvas aspect**: a new object per render
   * would re-aim the camera on every keystroke elsewhere on the screen and fight the person's own
   * orbiting, but a narrow pane needs a different distance from a wide one for the same building.
   */
  const aspect = size.height > 0 ? size.width / size.height : fallbackAspect;
  const frame = useMemo(
    () => cameraFrameFor(config, aspect),
    [config.span, config.length, config.height, aspect],
  );

  const spanM = config.span / 1000;
  const lengthM = config.length / 1000;
  const heightM = config.height / 1000;
  const centre: [number, number, number] = [spanM / 2, 0, lengthM / 2];
  const shadowHalf = frame.extent / 2 + 6;

  return (
    <div ref={containerRef} className={className} style={{ width: '100%', height: '100%' }}>
      <Canvas
        shadows={shadowsEnabled}
        dpr={[1, 2]}
        frameloop="demand"
        gl={{
          antialias: true,
          /*
           * Physical tone mapping and antialiasing: the difference between a diagram and a picture.
           * `ACESFilmic` keeps a bright sheet from clipping to flat white, which is what makes painted
           * steel read as steel rather than as a coloured shape.
           */
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
           * had most of itself outside the frustum and its shadow broke into blocks.
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
        <directionalLight position={[centre[0] - 22, 18, centre[2] - 14]} intensity={0.55} color="#dbe7f0" />

        {/*
          Ground and grid under the building, not under the origin. A plane at (0,0,0) sits in the
          building's corner and runs off in one direction, which reads as a tilted error.
        */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centre[0], -0.06, centre[2]]} receiveShadow={shadowsEnabled}>
          <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
          <meshStandardMaterial color="#bdb7ab" roughness={1} metalness={0} />
        </mesh>
        <gridHelper
          args={[frame.extent * 3, Math.max(12, Math.round((frame.extent * 3) / 2)), '#a9a396', '#cfc9bd']}
          position={[centre[0], -0.05, centre[2]]}
        />

        <Shed3D config={config} showRoof={showRoof} frameRows={frameRows} />

        {/*
          `resetView` is in the key, so pressing it re-mounts the framing component and re-aims the
          camera even when the building has not changed. The camera is not React state — OrbitControls
          writes straight to it every frame — so a prop is how a "go home" request has to arrive.
        */}
        <FrameCamera key={resetView} frame={frame} controls={controlsRef} />
        <QaCamera controls={controlsRef} />
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

/* Re-exported so a caller that wants a different layout can read the same numbers. */
export { cameraFrameFor } from './camera';
export type { CameraFrame } from './camera';
export { Shed3D } from './Shed3D';
export { AnyPart } from './PartMesh';
export { useContainerSize } from './useContainerSize';
export { useMediaQuery, DESKTOP_QUERY } from './useMediaQuery';
