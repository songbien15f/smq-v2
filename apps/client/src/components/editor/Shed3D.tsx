'use client';

/**
 * The 3D shed model.
 *
 * `buildWallShape` is the load-bearing part: it turns one `WallGeometry` into a
 * `THREE.Shape` with the outline wound counter-clockwise and every opening wound
 * clockwise. `THREE.ExtrudeGeometry` only punches material away when a hole's
 * winding opposes the outline's; a same-wound hole silently yields a solid wall
 * with no error (the door "vanishes"). The hole point order is therefore
 * deliberate and pinned by `__tests__/walls3d.test.ts`.
 *
 * This is the entire opening strategy (spec D4): `THREE.Shape` + `shape.holes` +
 * `ExtrudeGeometry`, no CSG dependency.
 *
 * The rest of the file maps `buildWallGeometries` output onto meshes. It derives
 * no domain geometry beyond the wall shape and the roof planes the brief
 * describes. All coordinates are millimetres; the scene group is scaled by
 * `1/1000` so the world is metre-based (spec §4.3).
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { ShedConfig, Opening, OpeningType, OptionKind } from '@sq/core/domain';
import { buildWallGeometries, type WallGeometry, type WallHole } from '@sq/core/domain';
import { computeBayPositions } from '@sq/core/domain';
import { doorColour, resolveOptions, type ResolvedOption } from '@sq/core/domain';

/** Wall thickness, mm. */
const WALL_DEPTH = 50;
/** Roof eave overhang beyond the walls, mm. */
const EAVE = 300;
/** Millimetres per metre; the scene is built in mm and scaled by this. */
const MM_TO_M = 0.001;
/** Thickness of the pane a skylight is drawn with, mm. */
const SKYLIGHT_PANE = 40;
/** Thickness of a mezzanine slab, mm. */
const MEZZANINE_SLAB = 150;
/** Leg cross-section of a mezzanine, mm. */
const MEZZANINE_LEG = 100;
/** Thickness of an awning's panel, mm. */
const AWNING_PANEL = 60;
/** Thickness of a dividing wall, mm. */
const DIVIDING_WALL_THICKNESS = 100;

/**
 * Whether an opening type is filled with a panel.
 *
 * A plain `opening` is a hole with nothing fitted into it — no door leaf, no
 * glass, no frame — so the 3D layer cuts the hole and draws nothing in it.
 */
export function hasOpeningPanel(type: OpeningType): boolean {
  return type !== 'opening';
}

/**
 * Whether an opening gets a track rail above its head.
 *
 * Only a sliding door runs on a track, and only when it has one: `none` means
 * the door is fitted without a rail, which is what a "no track" request asks
 * for. Every other type is on hinges or fixed, so it never has a rail.
 */
export function hasTrackRail(opening: Opening): boolean {
  return opening.type === 'sliding_door' && opening.track !== null && opening.track !== 'none';
}

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
export function buildOptionMeshes(shed: ShedConfig): OptionMesh[] {
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

/** Append a quad (two triangles) to a triangle list, preserving winding. */
function pushQuad(
  out: number[],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
): void {
  out.push(...a, ...b, ...c, ...a, ...c, ...d);
}

/**
 * Roof planes in millimetres, for the roof colour.
 *
 * Gable: two slopes meeting at a ridge along the length axis at mid-span, rise
 * `tan(pitch) × span / 2`. Skillion: a single plane falling along the length.
 * Both get a small eave overhang so the roof reads as a roof.
 */
function buildRoofGeometry(shed: ShedConfig): THREE.BufferGeometry {
  const pitch = (shed.roofPitchDeg * Math.PI) / 180;
  const rise = Math.tan(pitch) * (shed.span / 2);
  const eaveDrop = Math.tan(pitch) * EAVE;
  const vertices: number[] = [];

  if (shed.structureType === 'skillion' || shed.structureType === 'skillion_carport') {
    const fall = Math.tan(pitch) * shed.length;
    const zLow = shed.length + EAVE;
    const zHigh = -EAVE;
    pushQuad(
      vertices,
      [-EAVE, shed.height + fall, zHigh],
      [shed.span + EAVE, shed.height + fall, zHigh],
      [shed.span + EAVE, shed.height, zLow],
      [-EAVE, shed.height, zLow],
    );
  } else {
    const ridgeX = shed.span / 2;
    const ridgeY = shed.height + rise;
    const eaveY = shed.height - eaveDrop;
    const zNear = -EAVE;
    const zFar = shed.length + EAVE;
    // Left slope, then right slope, each spanning the eave overhang at both ends.
    pushQuad(
      vertices,
      [-EAVE, eaveY, zNear],
      [ridgeX, ridgeY, zNear],
      [ridgeX, ridgeY, zFar],
      [-EAVE, eaveY, zFar],
    );
    pushQuad(
      vertices,
      [shed.span + EAVE, eaveY, zNear],
      [ridgeX, ridgeY, zNear],
      [ridgeX, ridgeY, zFar],
      [shed.span + EAVE, eaveY, zFar],
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Pair each wall's holes with the openings that produced them, in order. */
function openingsForWall(config: ShedConfig, wall: WallGeometry): (Opening | undefined)[] {
  const wallOpenings = config.openings.filter((opening) => opening.wall === wall.side);
  return wall.holes.map((_hole, index) => wallOpenings[index]);
}

/** A thin panel filling one hole, styled by opening type. */
function OpeningPanel({
  hole,
  opening,
  colors,
}: {
  hole: WallHole;
  opening: Opening | undefined;
  colors: ShedConfig['colors'];
}) {
  const type = opening?.type ?? 'roller_door';
  // A plain hole has nothing fitted into it: the wall is cut and left open.
  if (!hasOpeningPanel(type)) return null;
  const cx = hole.u + hole.width / 2;
  const cy = hole.sill + hole.height / 2;
  const panelColor = doorColour(colors, type);

  // Roller door: a subtle horizontal rib pattern via repeated thin slats.
  if (type === 'roller_door') {
    const slats = Math.max(2, Math.round(hole.height / 450));
    const slatHeight = hole.height / slats;
    return (
      <group position={[cx, cy, WALL_DEPTH / 2]}>
        <mesh>
          <boxGeometry args={[hole.width, hole.height, 20]} />
          <meshStandardMaterial color={panelColor} metalness={0.3} roughness={0.7} />
        </mesh>
        {Array.from({ length: slats - 1 }, (_, index) => (
          <mesh
            key={index}
            position={[0, -hole.height / 2 + (index + 1) * slatHeight, 12]}
          >
            <boxGeometry args={[hole.width * 0.98, 18, 8]} />
            <meshStandardMaterial color={colors.barge} metalness={0.4} roughness={0.5} />
          </mesh>
        ))}
      </group>
    );
  }

  // Window: a translucent pane with a trim frame.
  if (type === 'window') {
    return (
      <group position={[cx, cy, WALL_DEPTH / 2]}>
        <mesh>
          <boxGeometry args={[hole.width, hole.height, 12]} />
          <meshStandardMaterial
            color={panelColor}
            transparent
            opacity={0.35}
            metalness={0.1}
            roughness={0.1}
          />
        </mesh>
        <mesh position={[0, 0, 8]}>
          <boxGeometry args={[hole.width + 60, hole.height + 60, 20]} />
          <meshStandardMaterial color={colors.barge} />
        </mesh>
      </group>
    );
  }

  // PA / sliding door: a solid panel with a frame; sliding adds a track line.
  const frame = 60;
  return (
    <group position={[cx, cy, WALL_DEPTH / 2]}>
      <mesh>
        <boxGeometry args={[hole.width, hole.height, 25]} />
        <meshStandardMaterial color={panelColor} metalness={0.2} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0, 16]}>
        <boxGeometry args={[hole.width - frame, hole.height - frame, 12]} />
        <meshStandardMaterial color={colors.barge} />
      </mesh>
      {opening !== undefined && hasTrackRail(opening) && (
        <mesh position={[0, hole.height / 2 + 30, 20]}>
          <boxGeometry args={[hole.width + 120, 30, 20]} />
          <meshStandardMaterial color={colors.barge} metalness={0.5} roughness={0.4} />
        </mesh>
      )}
      {/* A double track adds a second rail further out from the wall, which is
          what makes the two-track door read differently from a single. */}
      {opening !== undefined && hasTrackRail(opening) && opening.track === 'double' && (
        <mesh position={[0, hole.height / 2 + 30, 55]}>
          <boxGeometry args={[hole.width + 120, 30, 20]} />
          <meshStandardMaterial color={colors.barge} metalness={0.5} roughness={0.4} />
        </mesh>
      )}
    </group>
  );
}

/**
 * The shed scene contents, placed inside an R3F `<Canvas>` by `Render3D`.
 *
 * Geometry is memoised on the config, so only what moved re-renders (spec §7.2).
 */
export function Shed3D({ config }: { config: ShedConfig }) {
  const walls = useMemo(() => buildWallGeometries(config), [config]);
  const roof = useMemo(() => buildRoofGeometry(config), [config]);
  const optionMeshes = useMemo(() => buildOptionMeshes(config), [config]);
  const bayPositions = useMemo(
    () => computeBayPositions(config.length, config.bays),
    [config.length, config.bays],
  );

  return (
    <group scale={[MM_TO_M, MM_TO_M, MM_TO_M]}>
      {/* Floor slab. */}
      <mesh position={[config.span / 2, -25, config.length / 2]}>
        <boxGeometry args={[config.span, 50, config.length]} />
        <meshStandardMaterial color={config.colors.barge} roughness={0.95} />
      </mesh>

      {/* Four holed walls, each positioned and rotated by its domain transform. */}
      {walls.map((wall) => {
        const wallOpenings = openingsForWall(config, wall);
        return (
          <group
            key={wall.side}
            position={wall.transform.position}
            rotation={[0, wall.transform.rotationY, 0]}
          >
            <mesh>
              <extrudeGeometry
                args={[buildWallShape(wall), { depth: WALL_DEPTH, bevelEnabled: false }]}
              />
              <meshStandardMaterial
                color={config.colors.wall}
                side={THREE.DoubleSide}
                roughness={0.85}
                metalness={0.05}
              />
            </mesh>
            {wall.holes.map((hole, index) => (
              <OpeningPanel
                key={index}
                hole={hole}
                opening={wallOpenings[index]}
                colors={config.colors}
              />
            ))}
          </group>
        );
      })}

      {/* Framing hint: a thin column at each bay grid line on both long edges. */}
      {bayPositions.map((z, index) => (
        <group key={index}>
          {[0, config.span].map((x) => (
            <mesh key={x} position={[x, config.height / 2, z]}>
              <boxGeometry args={[90, config.height, 90]} />
              <meshStandardMaterial color={config.colors.barge} metalness={0.3} roughness={0.6} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Roof, semi-transparent so the interior stays readable. */}
      <mesh geometry={roof}>
        <meshStandardMaterial
          color={config.colors.roof}
          side={THREE.DoubleSide}
          transparent
          opacity={0.6}
          roughness={0.7}
          metalness={0.15}
        />
      </mesh>

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
