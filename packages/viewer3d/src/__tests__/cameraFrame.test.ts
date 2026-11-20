import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TEST_SHED } from '@sq/core/domain';
import type { DimensionedShed } from '@sq/core/domain';
import { cameraFrameFor } from '../camera';

/**
 * Where the 3D camera stands, asserted as arithmetic.
 *
 * The complaint that produced this file was "cho cái nhà ở giữa giống demo, cho xoay xem toàn bộ dễ" —
 * the camera was aimed at `(0,0,0)`, which in this coordinate system is a **corner** of the building,
 * so orbiting swung the shed out of frame. These tests pin the three properties that make it usable:
 * the target is the centre, the distance follows the building's size, and a bigger building is framed
 * from further away rather than overflowing.
 */

const shed = (patch: Partial<DimensionedShed> = {}): DimensionedShed => ({ ...TEST_SHED, ...patch });

describe('cameraFrameFor', () => {
  it('aims at the centre of the building, not at the origin', () => {
    const s = shed({ span: 12000, length: 24000, height: 4200 });
    const frame = cameraFrameFor(s);
    // Half the span, half the length, and a third of the height.
    expect(frame.target[0]).toBeCloseTo(6, 6);
    expect(frame.target[2]).toBeCloseTo(12, 6);
    expect(frame.target[1]).toBeCloseTo(1.4, 6);
  });

  it('stands off along a three-quarter view, so two walls and the roof are visible', () => {
    const s = shed({ span: 12000, length: 24000, height: 4200 });
    const frame = cameraFrameFor(s);
    // Offsets from the target are positive on both x and z, and x and z are equal.
    const dx = frame.position[0] - frame.target[0];
    const dz = frame.position[2] - frame.target[2];
    expect(dx).toBeGreaterThan(0);
    expect(dz).toBeGreaterThan(0);
    expect(dx).toBeCloseTo(dz, 6);
    // And above the centre.
    expect(frame.position[1]).toBeGreaterThan(frame.target[1]);
  });

  it('frames a small shed from closer than a large one', () => {
    const garage = cameraFrameFor(shed({ span: 6000, length: 9000, height: 2700 }));
    const transport = cameraFrameFor(shed({ span: 20000, length: 40000, height: 6000 }));
    const distance = (frame: ReturnType<typeof cameraFrameFor>) =>
      Math.hypot(
        frame.position[0] - frame.target[0],
        frame.position[1] - frame.target[1],
        frame.position[2] - frame.target[2],
      );
    expect(distance(transport)).toBeGreaterThan(distance(garage) * 2);
  });

  it('reports the longest side, which the orbit limits and the shadow camera are sized from', () => {
    expect(cameraFrameFor(shed({ span: 12000, length: 24000 })).extent).toBeCloseTo(24, 6);
    expect(cameraFrameFor(shed({ span: 30000, length: 18000 })).extent).toBeCloseTo(30, 6);
  });

  it('keeps the building inside the vertical field of view', () => {
    /*
     * The point of computing the distance from the field of view rather than using a constant: the
     * building's bounding sphere has to fit in the **narrower** of the two half-angles, or it is
     * cropped. This checks the arithmetic that makes that true for a tall narrow shed and a long low
     * one, in a square canvas.
     */
    const fovRad = (40 * Math.PI) / 180;
    for (const s of [
      shed({ span: 12000, length: 24000, height: 4200 }),
      shed({ span: 25000, length: 8000, height: 8000 }),
      shed({ span: 6000, length: 9000, height: 2700 }),
    ]) {
      const frame = cameraFrameFor(s, 1);
      const distance = Math.hypot(
        frame.position[0] - frame.target[0],
        frame.position[1] - frame.target[1],
        frame.position[2] - frame.target[2],
      );
      const radius = Math.hypot(s.span / 1000, s.height / 1000, s.length / 1000) / 2;
      // `sin(halfAngle) × distance` is the half-extent visible at that distance.
      expect(distance * Math.sin(fovRad / 2)).toBeGreaterThan(radius);
    }
  });

  it('stands further back in a tall narrow pane than in a wide one', () => {
    /*
     * The editor's 3D pane measured 535 × 608 — aspect 0.88 — and a distance computed from the
     * vertical angle alone let a 24 m shed run off **both** sides: the horizontal half-angle is
     * `atan(tan(fov/2) × aspect)`, tighter than the vertical one once the pane is taller than it is
     * wide. This is the property that fixes it.
     */
    const s = shed({ span: 12000, length: 24000, height: 4200 });
    const distance = (frame: ReturnType<typeof cameraFrameFor>) =>
      Math.hypot(
        frame.position[0] - frame.target[0],
        frame.position[1] - frame.target[1],
        frame.position[2] - frame.target[2],
      );
    const tall = cameraFrameFor(s, 0.88);
    const wide = cameraFrameFor(s, 2.4);
    expect(distance(tall)).toBeGreaterThan(distance(wide));
  });

  it('fits the horizontal extent in a pane taller than it is wide', () => {
    const s = shed({ span: 12000, length: 24000, height: 4200 });
    const aspect = 0.88;
    const frame = cameraFrameFor(s, aspect);
    const distance = Math.hypot(
      frame.position[0] - frame.target[0],
      frame.position[1] - frame.target[1],
      frame.position[2] - frame.target[2],
    );
    const halfH = Math.atan(Math.tan((40 * Math.PI) / 360) * aspect);
    const radius = Math.hypot(s.span / 1000, s.height / 1000, s.length / 1000) / 2;
    expect(distance * Math.sin(halfH)).toBeGreaterThan(radius);
  });
});

/**
 * The decisive test: project the building's eight corners through a real camera.
 *
 * Every earlier check here reasons about angles; this one builds the actual `PerspectiveCamera` the
 * canvas would use and asks whether the corners land inside the viewport. A pixel measurement in the
 * browser could not answer it — the ground plane fills the frame, so "not background" is the whole
 * canvas — and a wrong angle is exactly the defect ("the shed runs off both sides") this pins.
 */
describe('projected corners', () => {
  /** Project the shed's bounding-box corners and return their NDC range. */
  function projectedRange(shed: DimensionedShed, aspect: number) {
    const frame = cameraFrameFor(shed, aspect);
    const camera = new THREE.PerspectiveCamera(40, aspect, 0.5, 600);
    camera.position.set(...frame.position);
    camera.lookAt(new THREE.Vector3(...frame.target));
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    const spanM = shed.span / 1000;
    const lengthM = shed.length / 1000;
    const heightM = shed.height / 1000;
    const points: THREE.Vector3[] = [];
    for (const x of [0, spanM]) for (const y of [0, heightM]) for (const z of [0, lengthM]) {
      points.push(new THREE.Vector3(x, y, z).project(camera));
    }
    return {
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxY: Math.max(...points.map((p) => p.y)),
    };
  }

  const buildings = [
    ['a 12 × 24 m shed', { span: 12000, length: 24000, height: 4200 }],
    ['a small garage', { span: 6000, length: 9000, height: 2700 }],
    ['a long transport shed', { span: 20000, length: 40000, height: 5000 }],
    ['a tall narrow shed', { span: 8000, length: 12000, height: 8000 }],
  ] as const;

  for (const [label, patch] of buildings) {
    it(`puts every corner of ${label} on screen, in a tall pane`, () => {
      // The editor's 3D pane measured 535 × 608: taller than it is wide.
      const range = projectedRange(shed(patch), 535 / 608);
      // NDC runs −1..1; inside that range is on screen.
      expect(range.minX).toBeGreaterThan(-1);
      expect(range.maxX).toBeLessThan(1);
      expect(range.minY).toBeGreaterThan(-1);
      expect(range.maxY).toBeLessThan(1);
    });

    it(`puts every corner of ${label} on screen, in a wide pane`, () => {
      const range = projectedRange(shed(patch), 2.4);
      expect(range.minX).toBeGreaterThan(-1);
      expect(range.maxX).toBeLessThan(1);
      expect(range.minY).toBeGreaterThan(-1);
      expect(range.maxY).toBeLessThan(1);
    });
  }

  it('uses most of the frame rather than a speck in the middle', () => {
    // Fitting is worthless if the answer is "stand 300 m away". The building should fill at least
    // half the viewport in its longer direction.
    const range = projectedRange(shed({ span: 12000, length: 24000, height: 4200 }), 535 / 608);
    expect(range.maxX - range.minX).toBeGreaterThan(1);
  });
});
