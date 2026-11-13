'use client';

/**
 * The 3D shed model.
 *
 * `buildWallShape` is the load-bearing part: it turns one `WallGeometry` into a
 * `THREE.Shape` with the outline wound counter-clockwise and every opening wound
 * clockwise. `THREE.ExtrudeGeometry` only punches material away when a hole's
 * winding opposes the outline's; a same-wound hole silently yields a solid wall
 * with no error (the door "vanishes"). The hole point order is therefore
 * deliberate and pinned by `__tests__/`. `buildWallShape` itself is covered by the
 * demo's own assertions and by the elevations that share `buildWallGeometries`.
 *
 * This is the entire opening strategy (spec D4): `THREE.Shape` + `shape.holes` +
 * `ExtrudeGeometry`, no CSG dependency.
 *
 * ## Where the geometry comes from
 *
 * Nothing in this file derives building geometry any more. Openings are
 * `openingParts` and the shell is `structureParts`, both from `@sq/core/domain`, and both are
 * asserted as plain data in that package's tests. This component places those parts and shades
 * them; that is all it does. The one local remnant is `buildOptionMeshes`, which maps the option
 * union onto boxes because options are placed by the plan, not by a schedule.
 *
 * All coordinates are millimetres; the scene group is scaled by `1/1000` so the world is
 * metre-based (spec §4.3).
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { ShedConfig, OptionKind, DimensionedShed, FrameRowLayout } from '@sq/core/domain';
import { buildWallGeometries, type WallGeometry } from '@sq/core/domain';
import {
  openingParts,
  structureParts,
  type OpeningPart,
} from '@sq/core/domain';
import { resolveOptions, type ResolvedOption } from '@sq/core/domain';
import { AnyPart } from '@/components/three/PartMesh';
import { useSheetingTexture } from '@/components/three/useSheetingTexture';

/** Wall thickness, mm. */
const WALL_DEPTH = 50;
/** Millimetres per metre; the scene is built in mm and scaled by this. */
const MM_TO_M = 0.001;
/** Thickness of the pane a skylight is drawn with, mm. */
const SKYLIGHT_PANE = 40;
/** Thickness of a mezzanine slab, mm. */
const MEZZANINE_SLAB = 150;
/** Thickness of an awning's panel, mm. */
const AWNING_PANEL = 60;
/** Thickness of a dividing wall, mm. */
const DIVIDING_WALL_THICKNESS = 100;

/** One box (or prism) the 3D layer draws for an option, in millimetres. */
export interface OptionMesh {
  id: string;
  kind: OptionKind;
  /** Centre of the mesh in plan (x, z) and height (y). */
  position: [number, number, number];
  size: { width: number; height: number; depth: number };
  /** Present for a gable infill, which is a prism rather than a box. */
  triangle?: { base: number; rise: number };
  /** Present for a stable: which of its four walls are built. */
  panels?: { left: boolean; right: boolean; front: boolean; back: boolean };
}

/**
 * Turn each resolved option into a mesh description.
 *
 * This is the geometry half of the 3D option rendering, kept separate from the
 * JSX so it can be asserted without a WebGL context: a test can check that every
 * kind produces a positive-size box at the right height, which a rendered scene
 * in jsdom cannot.
 */
export function buildOptionMeshes(shed: DimensionedShed): OptionMesh[] {
  return resolveOptions(shed).map((option: ResolvedOption): OptionMesh | null => {
    const { rect, id, kind } = option;
    const centreX = rect.x + rect.width / 2;
    const centreZ = rect.y + rect.height / 2;

    switch (kind) {
      case 'skylight':
        return {
          id,
          kind,
          position: [centreX, option.zHigh, centreZ],
          size: { width: rect.width, height: SKYLIGHT_PANE, depth: rect.height },
        };

      case 'mezzanine':
        return {
          id,
          kind,
          position: [centreX, option.zLow + MEZZANINE_SLAB / 2, centreZ],
          size: { width: rect.width, height: MEZZANINE_SLAB, depth: rect.height },
        };

      case 'awning': {
        // The panel hangs off the wall at eave height, projecting outward from
        // the wall line. Its rect already covers that projection, so the mesh is
        // simply a thin slab over it.
        const alongX = rect.width >= rect.height;
        return {
          id,
          kind,
          position: [centreX, option.zLow, centreZ],
          size: alongX
            ? { width: rect.width, height: AWNING_PANEL, depth: rect.height }
            : { width: rect.width, height: AWNING_PANEL, depth: rect.height },
        };
      }

      case 'outrigger':
        return {
          id,
          kind,
          position: [centreX, option.zLow - 100, centreZ],
          size: { width: rect.width, height: 200, depth: rect.height },
        };

      case 'dividing_wall':
        return {
          id,
          kind,
          position: [centreX, option.zHigh / 2, centreZ],
          size: { width: rect.width, height: option.zHigh, depth: rect.height },
        };

      case 'gable_infill':
        return {
          id,
          kind,
          position: [centreX, option.zLow, centreZ],
          size: {
            width: rect.width,
            height: option.triangle?.rise ?? 0,
            depth: DIVIDING_WALL_THICKNESS,
          },
          triangle: option.triangle,
        };

      case 'stable':
        return {
          id,
          kind,
          position: [centreX, option.zHigh / 2, centreZ],
          size: { width: rect.width, height: option.zHigh, depth: rect.height },
          panels: option.panels,
        };

      case 'carry_beam':
      case 'cantilever':
        return {
          id,
          kind,
          position: [centreX, (option.zLow + option.zHigh) / 2, centreZ],
          size: { width: rect.width, height: option.zHigh - option.zLow, depth: rect.height },
        };

      case 'horizontal_cladding':
        return {
          id,
          kind,
          position: [centreX, (option.zLow + option.zHigh) / 2, centreZ],
          size: { width: rect.width, height: option.zHigh - option.zLow, depth: rect.height },
        };

      case 'overhang':
        return {
          id,
          kind,
          position: [centreX, option.zHigh, centreZ],
          size: { width: rect.width, height: 60, depth: rect.height },
        };
      case 'misc_option':
        // `resolveOptions` already drops it; this states the reason for the compiler.
        return null;
    }
  }).filter((mesh): mesh is OptionMesh => mesh !== null);
}

/**
 * One wall as a `THREE.Shape`: a rectangular outline wound counter-clockwise,
 * with one clockwise-wound hole per opening.
 *
 * Outline: (0,0) → (width,0) → (width,height) → (0,height) is counter-clockwise.
 * Hole: (u,sill) → (u,sill+height) → (u+width,sill+height) → (u+width,sill) is
 * clockwise, i.e. opposite the outline, which is what makes ExtrudeGeometry cut
 * it out rather than ignore it.
 */
export function buildWallShape(wall: WallGeometry): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(wall.width, 0);
  shape.lineTo(wall.width, wall.height);
  shape.lineTo(0, wall.height);
  shape.lineTo(0, 0); // outline: counter-clockwise
  for (const h of wall.holes) {
    const path = new THREE.Path();
    path.moveTo(h.u, h.sill);
    path.lineTo(h.u, h.sill + h.height); // hole: clockwise (opposite the
    path.lineTo(h.u + h.width, h.sill + h.height); // outline) — required for
    path.lineTo(h.u + h.width, h.sill); // ExtrudeGeometry to punch through
    path.lineTo(h.u, h.sill);
    shape.holes.push(path);
  }
  return shape;
}

/**
 * The shed scene contents, placed inside an R3F `<Canvas>` by `Render3D`.
 *
 * Geometry is memoised on the config, so only what moved re-renders (spec §7.2).
 */
export function Shed3D({
  config,
  showRoof = true,
  frameRows = null,
}: {
  config: DimensionedShed;
  /** Hide the roof (and its trim) to look inside. Walls, frame and openings stay. */
  showRoof?: boolean;
  /**
   * Purlin and girt row heights from the last evaluation, or `null` before there is one.
   *
   * The rows come from the price book's span table, which the client never sees directly, so before
   * an evaluation there is nothing honest to draw and no purlin appears. Columns and rafters are at
   * the bay lines either way.
   */
  frameRows?: FrameRowLayout | null;
}) {
  const wallTexture = useSheetingTexture();
  const walls = useMemo(() => buildWallGeometries(config), [config]);
  const optionMeshes = useMemo(() => buildOptionMeshes(config), [config]);
  const shell = useMemo(
    () => structureParts(config, { showRoof, frameRows }),
    [config, showRoof, frameRows],
  );

  return (
    <group scale={[MM_TO_M, MM_TO_M, MM_TO_M]}>
      {/* Floor slab. */}
      <mesh position={[config.span / 2, -25, config.length / 2]} receiveShadow>
        <boxGeometry args={[config.span, 50, config.length]} />
        <meshStandardMaterial color={config.colors.barge} roughness={0.95} />
      </mesh>

      {/* Four holed walls, each positioned and rotated by its domain transform. */}
      {walls.map((wall) => {
        const onWall = config.openings.filter((opening) => opening.wall === wall.side);
        return (
          <group
            key={wall.side}
            position={wall.transform.position}
            rotation={[0, wall.transform.rotationY, 0]}
          >
            <mesh castShadow receiveShadow>
              <extrudeGeometry
                args={[buildWallShape(wall), { depth: WALL_DEPTH, bevelEnabled: false }]}
              />
              <meshStandardMaterial
                color={config.colors.wall}
                map={wallTexture}
                bumpMap={wallTexture}
                bumpScale={0.4}
                side={THREE.DoubleSide}
                roughness={0.5}
                metalness={0.35}
                envMapIntensity={1.1}
              />
            </mesh>
            {/*
              Hardware for each hole. The parts are derived by the domain (`openingParts`), so what
              is drawn here is exactly what the tests in `@sq/core/domain` describe.
            */}
            {wall.holes.map((hole, index) => {
              const opening = onWall[index];
              if (opening === undefined) return null;
              return (
                <group key={opening.id}>
                  {openingParts(opening, hole.u, config.colors).map((part: OpeningPart) => (
                    <AnyPart key={part.kind} part={part} />
                  ))}
                </group>
              );
            })}
          </group>
        );
      })}

      {/* Frame, roof, trim and gutters: the shell the quote always includes. */}
      {shell.map((part, index) => (
        <AnyPart key={`${part.kind}-${index}`} part={part} />
      ))}

      {/* Added objects. Drawn after the roof so a skylight reads as sitting on
          it rather than being hidden by it. */}
      {optionMeshes.map((option) => {
        if (option.triangle !== undefined) {
          return <GableInfillMesh key={option.id} option={option} colors={config.colors} />;
        }
        const [x, y, z] = option.position;
        const { width, height, depth } = option.size;

        // A stable is four walls, not a solid block: a solid box would hide the
        // fact that a user can leave a side open, and would fill a shelter the
        // customer is buying as a shelter.
        if (option.kind === 'stable' && option.panels !== undefined) {
          return (
            <StableMesh key={option.id} option={option} colors={config.colors} />
          );
        }

        // A skylight is a pane, so it is translucent; everything else is a solid
        // fixture drawn in the trim colour.
        const translucent = option.kind === 'skylight';
        return (
          <mesh key={option.id} position={[x, y, z]}>
            <boxGeometry args={[width, height, depth]} />
            <meshStandardMaterial
              color={config.colors.barge}
              transparent={translucent}
              opacity={translucent ? 0.45 : 1}
              metalness={0.25}
              roughness={0.6}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * A stable as four optional walls plus a roof slab.
 *
 * A single box would be wrong twice over: it would hide that a side can be left
 * open, and it would look like a solid block rather than a shelter. Each panel
 * is a thin wall on its own edge, drawn only when its flag is on.
 */
function StableMesh({ option, colors }: { option: OptionMesh; colors: ShedConfig['colors'] }) {
  const [x, y, z] = option.position;
  const { width, height, depth } = option.size;
  const panels = option.panels ?? { left: true, right: true, front: true, back: true };
  const wall = 60;
  const halfW = width / 2;
  const halfD = depth / 2;

  return (
    <group position={[x, y, z]}>
      {/* Roof slab, so the shelter reads as enclosed from above. */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[width, 60, depth]} />
        <meshStandardMaterial color={colors.roof} roughness={0.85} />
      </mesh>
      {panels.left && (
        <mesh position={[-halfW, 0, 0]}>
          <boxGeometry args={[wall, height, depth]} />
          <meshStandardMaterial color={colors.wall} roughness={0.9} />
        </mesh>
      )}
      {panels.right && (
        <mesh position={[halfW, 0, 0]}>
          <boxGeometry args={[wall, height, depth]} />
          <meshStandardMaterial color={colors.wall} roughness={0.9} />
        </mesh>
      )}
      {panels.front && (
        <mesh position={[0, 0, halfD]}>
          <boxGeometry args={[width, height, wall]} />
          <meshStandardMaterial color={colors.wall} roughness={0.9} />
        </mesh>
      )}
      {panels.back && (
        <mesh position={[0, 0, -halfD]}>
          <boxGeometry args={[width, height, wall]} />
          <meshStandardMaterial color={colors.wall} roughness={0.9} />
        </mesh>
      )}
    </group>
  );
}

/**
 * A gable infill as a triangular prism: the triangle above wall height, extruded
 * through the wall thickness. `THREE.ExtrudeGeometry` takes the shape in the XY
 * plane, so the triangle is built with its base on the wall line and its apex at
 * the ridge height, then the mesh is positioned at the end of the shed.
 */
function GableInfillMesh({
  option,
  colors,
}: {
  option: OptionMesh;
  colors: ShedConfig['colors'];
}) {
  const geometry = useMemo(() => {
    const { width } = option.size;
    const rise = option.triangle?.rise ?? 0;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(width, 0);
    shape.lineTo(width / 2, rise);
    shape.lineTo(0, 0);
    return new THREE.ExtrudeGeometry(shape, {
      depth: WALL_DEPTH,
      bevelEnabled: false,
    });
  }, [option.size, option.triangle?.rise]);

  const [x, y, z] = option.position;
  return (
    <mesh
      geometry={geometry}
      position={[x - option.size.width / 2, y, z]}
      rotation={[0, 0, 0]}
    >
      <meshStandardMaterial
        color={colors.wall}
        side={THREE.DoubleSide}
        roughness={0.85}
        metalness={0.05}
      />
    </mesh>
  );
}
