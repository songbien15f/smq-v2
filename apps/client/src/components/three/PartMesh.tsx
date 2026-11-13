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
        metalness={metal ? 0.85 : glass ? 0.05 : 0.35}
        roughness={metal ? 0.3 : glass ? 0.04 : part.finish === 'sheet' ? 0.45 : 0.5}
        envMapIntensity={metal ? 1.25 : 1}
        transparent={glass}
        opacity={part.opacity ?? 1}
        side={part.finish === 'sheet' ? THREE.DoubleSide : THREE.FrontSide}
      />
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
            shape.lineTo(0, rise / 2);
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
