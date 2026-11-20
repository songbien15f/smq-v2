'use client';

/**
 * The demo building: walls with real holes, per-type opening hardware, and the shell in between.
 *
 * Nothing here is demo-specific geometry — the walls come from `buildWallGeometries`, the openings
 * from `openingParts`, the roof and frame from `structureParts`. The point of `/demo` is to judge
 * that shared geometry before it reaches the editor, so a demo that drew its own shapes would be
 * showing something the product does not have.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { buildWallGeometries, openingParts, structureParts } from '@sq/core/domain';
import type { DimensionedShed, Opening, WallSide } from '@sq/core/domain';
import { buildWallShape, AnyPart, useSheetingTexture } from '@sq/viewer3d';

/** Wall thickness, mm — the same value the editor extrudes. */
const WALL_DEPTH = 50;
const SLAB = 150;

const SIDES: WallSide[] = ['front', 'back', 'left', 'right'];

interface Props {
  config: DimensionedShed;
  showRoof: boolean;
  showDoors: boolean;
}

export function DemoBuilding({ config, showRoof, showDoors }: Props) {
  const wallTexture = useSheetingTexture();

  const walls = useMemo(
    () => buildWallGeometries(config).map((wall) => ({ wall, shape: buildWallShape(wall) })),
    [config],
  );

  const openingsByWall = useMemo(() => {
    const map = new Map<WallSide, Opening[]>();
    for (const side of SIDES) map.set(side, config.openings.filter((o) => o.wall === side));
    return map;
  }, [config.openings]);

  const shell = useMemo(
    () => structureParts(config, { showRoof, frameRows: null }),
    [config, showRoof],
  );

  return (
    <group scale={[0.001, 0.001, 0.001]}>
      {/* Slab, slightly larger than the shed so it reads as an apron. */}
      <mesh position={[config.span / 2, -SLAB / 2, config.length / 2]} receiveShadow>
        <boxGeometry args={[config.span + 1200, SLAB, config.length + 1200]} />
        <meshStandardMaterial color="#b8b3a9" roughness={0.95} metalness={0} />
      </mesh>

      {/* Four walls, each with its own holes, in the product's own transform. */}
      {walls.map(({ wall, shape }) => {
        const onWall = openingsByWall.get(wall.side) ?? [];
        return (
          <group
            key={wall.side}
            position={wall.transform.position}
            rotation={[0, wall.transform.rotationY, 0]}
          >
            <mesh castShadow receiveShadow>
              <extrudeGeometry args={[shape, { depth: WALL_DEPTH, bevelEnabled: false }]} />
              <meshStandardMaterial
                color={config.colors.wall}
                map={wallTexture}
                bumpMap={wallTexture}
                bumpScale={0.4}
                metalness={0.35}
                roughness={0.5}
                side={THREE.DoubleSide}
                envMapIntensity={1.1}
              />
            </mesh>

            {showDoors &&
              wall.holes.map((hole, index) => {
                const opening = onWall[index];
                if (opening === undefined) return null;
                return (
                  <group key={opening.id}>
                    {openingParts(opening, hole.u, config.colors).map((part) => (
                      <AnyPart key={part.kind} part={part} />
                    ))}
                  </group>
                );
              })}
          </group>
        );
      })}

      {/* Roof, trim, gutters, gable ends and the steel frame. */}
      {shell.map((part, index) => (
        <AnyPart key={`${part.kind}-${index}`} part={part} />
      ))}
    </group>
  );
}
