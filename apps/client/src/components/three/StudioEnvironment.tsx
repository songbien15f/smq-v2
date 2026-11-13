'use client';

/**
 * The studio environment every 3D view is lit by.
 *
 * ## Why an environment map at all
 *
 * Painted steel and galvanised steel are metals, and a metal with nothing to reflect renders as a
 * flat grey shape. `RoomEnvironment` is a small procedural box of soft lights that ships with three;
 * run through `PMREMGenerator` it gives every metal surface a highlight, which is the single
 * cheapest step from "a model" to "a photograph of a shed".
 *
 * **Nothing is downloaded.** No HDR file, no CDN request: the environment is generated in the
 * browser from geometry, so it works offline and ships nothing extra.
 */

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function StudioEnvironment(): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  return null;
}
