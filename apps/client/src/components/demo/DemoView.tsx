'use client';

/**
 * `/demo` — a fixed building, drawn with the same wall model as the editor but with the
 * dressing the editor does not have yet: per-type door hardware, a proper roof, gutters,
 * downpipes, and an environment map.
 *
 * It is a **reference page**, not a product screen: no session, no quote, no API. Everything
 * is derived from `DEMO_SHED`, so it is also a stable target to screenshot when comparing
 * renders over time.
 */

import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useContainerSize } from '@sq/viewer3d';
import { StudioEnvironment } from '@sq/viewer3d';
import { DEMO_SHED } from './fixture';
import { DemoBuilding } from './DemoBuilding';

const LEGEND = [
  { label: 'Roller door', detail: 'guides, drum, springs', swatch: DEMO_SHED.colors.rollerDoor },
  { label: 'PA door', detail: 'frame + leaf swung 22°', swatch: DEMO_SHED.colors.paDoor },
  { label: 'Sliding door', detail: 'two leaves, two tracks', swatch: DEMO_SHED.colors.slidingDoor },
  { label: 'Window', detail: 'frame ring, mullion, glass', swatch: DEMO_SHED.colors.window },
] as const;

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={value}
      onClick={() => onChange(!value)}
      className={[
        'min-h-9 cursor-pointer rounded-md border px-sq-2 text-sq-micro font-medium transition-colors',
        value
          ? 'border-sq-brand bg-sq-brand text-white'
          : 'border-sq-line bg-sq-surface text-sq-ink-muted hover:bg-sq-ground',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

export function DemoView() {
  const [showRoof, setShowRoof] = useState(true);
  const [showDoors, setShowDoors] = useState(true);

  // R3F sizes its canvas from `ResizeObserver`, which this environment does not always deliver:
  // without this the canvas stays at 300 × 150 after a reload. Same workaround as the editor.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useContainerSize(containerRef);

  return (
    <div
      ref={containerRef}
      className="relative h-[100dvh] w-full overflow-hidden bg-[linear-gradient(180deg,#cfe3f2_0%,#e8eef2_45%,#d8d3c8_100%)]"
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        camera={{ position: [17, 9.5, 23], fov: 40, near: 0.5, far: 400 }}
      >
        <StudioEnvironment />

        <hemisphereLight args={['#dcefff', '#b7a992', 0.55]} />
        <directionalLight
          castShadow
          position={[28, 34, 14]}
          intensity={2.4}
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-24}
          shadow-camera-right={24}
          shadow-camera-top={24}
          shadow-camera-bottom={-24}
          shadow-camera-near={1}
          shadow-camera-far={90}
          shadow-bias={-0.0004}
          shadow-normalBias={0.03}
        />
        <directionalLight position={[-22, 18, -14]} intensity={0.55} color="#dbe7f0" />

        {/* Ground plane, in metres like the camera. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[6, -0.16, 9]} receiveShadow>
          <planeGeometry args={[160, 160]} />
          <meshStandardMaterial color="#bdb7ab" roughness={1} metalness={0} />
        </mesh>

        <DemoBuilding config={DEMO_SHED} showRoof={showRoof} showDoors={showDoors} />

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          target={[6, 2.4, 9]}
          minDistance={8}
          maxDistance={60}
          maxPolarAngle={Math.PI / 2 - 0.02}
        />
      </Canvas>

      {/* Title and legend. */}
      <div className="pointer-events-none absolute left-sq-4 top-sq-4 max-w-xs rounded-lg border border-sq-line bg-sq-surface/90 p-sq-3 shadow-sm backdrop-blur">
        <p className="text-sq-micro font-semibold uppercase tracking-wide text-sq-ink-muted">
          3D demo
        </p>
        <h1 className="mt-sq-1 text-sq-body font-semibold text-sq-ink">
          12 × 18 m gable shed
        </h1>
        <p className="mt-sq-1 text-sq-micro text-sq-ink-muted">
          Three 6 m bays, 4.2 m walls, 15° pitch. Four opening types and one plain hole.
        </p>
        <ul className="mt-sq-3 flex flex-col gap-sq-1">
          {LEGEND.map((item) => (
            <li key={item.label} className="flex items-center gap-sq-2 text-sq-micro">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10"
                style={{ backgroundColor: item.swatch }}
              />
              <span className="font-medium text-sq-ink">{item.label}</span>
              <span className="text-sq-ink-muted">— {item.detail}</span>
            </li>
          ))}
          <li className="flex items-center gap-sq-2 text-sq-micro">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10 bg-white/40" />
            <span className="font-medium text-sq-ink">Opening</span>
            <span className="text-sq-ink-muted">— cut, nothing fitted</span>
          </li>
        </ul>
      </div>

      {/* View controls. */}
      <div className="absolute right-sq-4 top-sq-4 flex gap-sq-2 rounded-lg border border-sq-line bg-sq-surface/90 p-sq-2 shadow-sm backdrop-blur">
        <Toggle label="Roof" value={showRoof} onChange={setShowRoof} />
        <Toggle label="Doors" value={showDoors} onChange={setShowDoors} />
      </div>

      <p className="pointer-events-none absolute bottom-sq-3 right-sq-4 rounded-md bg-sq-surface/80 px-sq-2 py-sq-1 text-sq-micro text-sq-ink-muted backdrop-blur">
        Drag to orbit · scroll to zoom
      </p>
    </div>
  );
}
