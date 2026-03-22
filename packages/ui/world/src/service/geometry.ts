import * as THREE from "three";

/** Clone of unit quad in XZ plane from (0,0,0) to (1,0,1). */
export function createXzQuad() {
  return unitXzQuad.clone();
}

const unitXzQuad = new THREE.BufferGeometry();
unitXzQuad.setAttribute(
  "position",
  // biome-ignore format: meaningful newlines
  new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    1, 0, 1,
    0, 0, 1,
  ], 3),
);
unitXzQuad.setAttribute(
  "normal",
  // biome-ignore format: meaningful newlines
  new THREE.Float32BufferAttribute([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ], 3),
);
unitXzQuad.setAttribute(
  "uv",
  // biome-ignore format: meaningful newlines
  new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ], 2),
);
// biome-ignore format: meaningful newlines
unitXzQuad.setIndex([
  0, 2, 1,
  0, 3, 2,
]);
