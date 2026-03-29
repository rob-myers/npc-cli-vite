/**
 * 🔔 editing causes full-page-reload sinc this file also used by webworker.
 * Can fix by split into separate files.
 */

import { Rect } from "@npc-cli/util/geom/rect";
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

/** Clone of unit quad in XY plane from (0,0,0) to (1,1,0). */
export function createXyQuad() {
  return unitXyQuad.clone();
}

const unitXyQuad = new THREE.BufferGeometry();
unitXyQuad.setAttribute(
  "position",
  // biome-ignore format: meaningful newlines
  new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,
  ], 3),
);
unitXyQuad.setAttribute(
  "normal",
  // biome-ignore format: meaningful newlines
  new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3),
);
unitXyQuad.setAttribute(
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
unitXyQuad.setIndex([
  0, 2, 1,
  0, 3, 2,
]);

/** Embed a 2D affine transform into three.js XZ plane. */
export function embedXZMat4(
  transform: Geom.AffineTransform,
  { yScale, yHeight, mat4 }: { yScale?: number; yHeight?: number; mat4?: THREE.Matrix4 } = {},
) {
  // biome-ignore format: meaningful newlines
  return (mat4 ?? new THREE.Matrix4()).set(
    transform.a, 0,            transform.c, transform.e,
    0,            yScale ?? 1,  0,            yHeight ?? 0,
    transform.b, 0,            transform.d, transform.f,
    0,            0,            0,             1
  );
}

export function decompToXZGeometry(decomp: Geom.Triangulation, { reverse = false } = {}) {
  const geometry = new THREE.BufferGeometry();
  const { vertices, indices, uvs } = decompToXZAttribs(decomp);
  reverse && indices.reverse();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.setIndex(indices);
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  return geometry;
}

function decompToXZAttribs(decomp: Geom.Triangulation) {
  const vertices = decomp.vs.flatMap((v) => [v.x, 0, v.y]);
  const indices = decomp.tris.flat();
  const bounds = Rect.fromPoints(...decomp.vs);
  const uvs = decomp.vs.flatMap(({ x, y }) => [(x - bounds.x) / bounds.width, (y - bounds.y) / bounds.height]);
  return { vertices, indices, uvs };
}
