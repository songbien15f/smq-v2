'use client';

/**
 * One part of a building, drawn.
 *
 * Every renderer that draws millimetre geometry from `@sq/core/domain` goes through this component,
 * so a door guide, a roof slope and a purlin all shade the same way and a new part cannot quietly
 * invent its own material recipe.
 *
 * The `finish` on the part decides the material: `metal` is bright and reflective, `glass` is a thin
 * transparent pane, `trim` and `sheet` are painted steel at different roughness. Colour always comes
 * from the shed's own colour roles, so a quote's palette reaches the model.
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { OpeningPart } from '@sq/core/domain';

/** The three.js geometry a part needs, built from the part's own description. */
function geometryFor(part: OpeningPart) {
  if (part.shape === 'cylinder') {
    return <cylinderGeometry args={[part.radius ?? 10, part.radius ?? 10, part.height ?? 10, 20]} />;
  }
  if (part.shape === 'torus') {
    return <torusGeometry args={[part.radius ?? 10, part.tube ?? 2, 12, 28]} />;
  }
  return <boxGeometry args={part.size ?? [10, 10, 10]} />;
}

export function PartMesh({ part, castShadow = true }: { part: OpeningPart; castShadow?: boolean }) {
  const glass = part.finish === 'glass';
  const metal = part.finish === 'metal';
  const sheet = part.finish === 'sheet';
  /*
   * Roof and wall are usually the *same paint* in the customer's palette (Surfmist on Surfmist is the
   * default), so telling them apart cannot rely on colour.
   *
   * Material alone was not enough: measured 2026-11-24, making the roof glossier moved its luminance
   * *towards* the wall's and narrowed the gap from ΔL 0.131 to 0.083. So the sheet keeps a modest
   * metalness (0.5) and roughness (0.42) against the wall's 0.35 / 0.5, and what does the separating
   * is the **outline**: how a person reads an eave is the line where the plane turns. It is drawn in
   * the navy the rest of the product already uses — no new colour, no change to the customer's palette.
   */
  const edge = useMemo(() => {
    if (!sheet || (part.shape ?? 'box') !== 'box') return null;
    const [w, h, d] = part.size ?? [10, 10, 10];
    // The box exists only to be read: its edges are copied out, then it is released immediately.
    const box = new THREE.BoxGeometry(w, h, d);
    const geometry = new THREE.EdgesGeometry(box);
    box.dispose();
    return geometry;
  }, [sheet, part.shape, part.size?.[0], part.size?.[1], part.size?.[2]]);

  // A geometry that is replaced (a resize) or abandoned (unmount) must free its GPU buffers.
  useEffect(() => () => edge?.dispose(), [edge]);

  return (
    <mesh
      position={part.position}
      rotation={part.rotation}
      castShadow={castShadow && !glass}
      receiveShadow={!glass}
    >
      {geometryFor(part)}
      <meshStandardMaterial
        color={part.color}
        // A roof panel is a sheet of steel: keep the light metalness, and let the outline do the
        // separating rather than bending the paint's brightness.
        metalness={metal ? 0.85 : glass ? 0.05 : sheet ? 0.5 : 0.35}
        roughness={metal ? 0.26 : glass ? 0.04 : sheet ? 0.42 : 0.5}
        envMapIntensity={metal ? 1.4 : sheet ? 1.2 : 1}
        transparent={glass}
        opacity={part.opacity ?? 1}
        side={sheet ? THREE.DoubleSide : THREE.FrontSide}
      />
      {edge === null ? null : (
        <lineSegments geometry={edge}>
          <lineBasicMaterial color="#0b1d4d" transparent opacity={0.3} />
        </lineSegments>
      )}
    </mesh>
  );
}

/**
 * A triangular gable end, extruded through the wall thickness.
 *
 * The part carries `triangle` (base and rise) and the renderer builds the prism from it, rather than
 * approximating the end with a box — which is what makes a gable read as a gable.
 */
export function TrianglePart({ part }: { part: OpeningPart }) {
  const [width, height, depth] = part.size ?? [0, 0, 0];
  const base = part.triangle?.base ?? width;
  const rise = part.triangle?.rise ?? height;

  return (
    <mesh position={part.position} castShadow receiveShadow>
      <extrudeGeometry
        args={[
          (() => {
            const shape = new THREE.Shape();
            shape.moveTo(-base / 2, -rise / 2);
            shape.lineTo(base / 2, -rise / 2);
            // A right-angled wedge (a skillion end) peaks over its high side, not the middle.
            shape.lineTo(part.triangle?.rightAngle === true ? base / 2 : 0, rise / 2);
            shape.lineTo(-base / 2, -rise / 2);
            return shape;
          })(),
          { depth, bevelEnabled: false },
        ]}
      />
      <meshStandardMaterial
        color={part.color}
        metalness={0.35}
        roughness={0.5}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** True when a part is a triangle and needs `TrianglePart` rather than a box. */
export function isTriangle(part: OpeningPart): boolean {
  return part.triangle !== undefined;
}

/** Draw any part: a triangle gets its prism, everything else its own shape. */
export function AnyPart({ part }: { part: OpeningPart }) {
  return isTriangle(part) ? <TrianglePart part={part} /> : <PartMesh part={part} />;
}
