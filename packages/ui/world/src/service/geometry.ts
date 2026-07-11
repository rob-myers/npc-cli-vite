import { Rect } from "@npc-cli/util/geom/rect";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

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

/** Two-sided XZ quad: both face windings in one geometry, use with FrontSide material. */
export function createTwoSidedXzQuad() {
  return unitTwoSidedXzQuad.clone();
}

/** Two-sided XY quad: both face windings in one geometry, use with FrontSide material. */
export function createTwoSidedXyQuad() {
  return unitTwoSidedXyQuad.clone();
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

// Vertices 0-3: front (+Y normal). Vertices 4-7: back (-Y normal), same positions.
// Back winding [4,5,6, 4,6,7] produces cross-product pointing -Y.
const unitTwoSidedXzQuad = new THREE.BufferGeometry();
// biome-ignore format: meaningful newlines
unitTwoSidedXzQuad.setAttribute("position", new THREE.Float32BufferAttribute([
  0,0,0, 1,0,0, 1,0,1, 0,0,1,
  0,0,0, 1,0,0, 1,0,1, 0,0,1,
], 3));
// biome-ignore format: meaningful newlines
unitTwoSidedXzQuad.setAttribute("normal", new THREE.Float32BufferAttribute([
   0,1,0,  0,1,0,  0,1,0,  0,1,0,
   0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
], 3));
// biome-ignore format: meaningful newlines
unitTwoSidedXzQuad.setAttribute("uv", new THREE.Float32BufferAttribute([
  0,0, 1,0, 1,1, 0,1,
  0,0, 1,0, 1,1, 0,1,
], 2));
// biome-ignore format: meaningful newlines
unitTwoSidedXzQuad.setIndex([
  0,2,1, 0,3,2,  // front (CCW from +Y)
  4,5,6, 4,6,7,  // back  (CW from +Y)
]);

// Vertices 0-3: front (+Z normal). Vertices 4-7: back (-Z normal), same positions.
// Back winding [4,6,5, 4,7,6] produces cross-product pointing -Z.
const unitTwoSidedXyQuad = new THREE.BufferGeometry();
// biome-ignore format: meaningful newlines
unitTwoSidedXyQuad.setAttribute("position", new THREE.Float32BufferAttribute([
  0,0,0, 1,0,0, 1,1,0, 0,1,0,
  0,0,0, 1,0,0, 1,1,0, 0,1,0,
], 3));
// biome-ignore format: meaningful newlines
unitTwoSidedXyQuad.setAttribute("normal", new THREE.Float32BufferAttribute([
  0,0,1,  0,0,1,  0,0,1,  0,0,1,
  0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
], 3));
// biome-ignore format: meaningful newlines
unitTwoSidedXyQuad.setAttribute("uv", new THREE.Float32BufferAttribute([
  0,0, 1,0, 1,1, 0,1,
  0,0, 1,0, 1,1, 0,1,
], 2));
// biome-ignore format: meaningful newlines
unitTwoSidedXyQuad.setIndex([
  0,2,1, 0,3,2,  // front: geometric normal -Z (CCW from -Z)
  4,5,6, 4,6,7,  // back:  geometric normal +Z (CCW from +Z)
]);

/** Embed a 2D affine transform into three.js XZ plane. */
export function embedXZMat4(
  transform: Geom.AffineTransform,
  { yScale, yHeight, mat4 }: { yScale?: number; yHeight?: number; mat4?: THREE.Matrix4 } = {},
) {
  // biome-ignore format: meaningful newlines
  return (mat4 ?? new THREE.Matrix4()).set(
    transform.a, 0,           transform.c, transform.e,
    0,           yScale ?? 1, 0,           yHeight ?? 0,
    transform.b, 0,           transform.d, transform.f,
    0,           0,           0,           1
  );
}

export function createDoorBox() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  // Merge the 4 edge faces (+x -x +y -y, indices 0–23) into one group → 3 draw calls instead of 6
  g.groups = [
    { start: 0, count: 24, materialIndex: 0 }, // edges
    { start: 24, count: 6, materialIndex: 1 }, // +z front
    { start: 30, count: 6, materialIndex: 2 }, // -z back
  ];
  g.setAttribute("openRatio", new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
  g.setAttribute("slideSign", new THREE.InstancedBufferAttribute(new Float32Array([1]), 1));
  g.setAttribute("flipFrontBack", new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
  g.setAttribute("doorBackLabelLayer", new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
  return g;
}

/** Flat XZ-plane arrow pointing +X, x∈[0,1], for instanced debug rendering. */
export function createArrowGeo(): THREE.BufferGeometry {
  const shaftEnd = 0.75,
    shaftHW = 0.02,
    headHW = 0.2;
  // biome-ignore format: vertex layout
  const positions = new Float32Array([
    0,        0, -shaftHW,  // 0 shaft bl
    shaftEnd, 0, -shaftHW,  // 1 shaft br
    shaftEnd, 0,  shaftHW,  // 2 shaft tr
    0,        0,  shaftHW,  // 3 shaft tl
    shaftEnd, 0, -headHW,   // 4 head base-
    1.0,      0,  0,        // 5 head apex
    shaftEnd, 0,  headHW,   // 6 head base+
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6]), 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create an XZ plane quad with skinning attributes.
 * All vertices are bound to `jointIndex` with weight 1.
 */
export function createSkinnedXzQuad(width: number, depth: number, jointIndex = 0) {
  const geo = createXzQuad();
  // scale from unit quad
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, (pos.getX(i) - 0.5) * width);
    pos.setZ(i, (pos.getZ(i) - 0.5) * depth);
  }

  const vc = pos.count;
  const skinIndices = new Uint16Array(vc * 4);
  const skinWeights = new Float32Array(vc * 4);
  for (let i = 0; i < vc; i++) {
    skinIndices[i * 4] = jointIndex;
    skinWeights[i * 4] = 1;
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  return geo;
}

/**
 * Create a billboard label quad with skinning attributes.
 * All 4 vertices share the same position so skinning moves them identically.
 * Corner offsets are stored in a `billboardOffset` vec2 attribute
 * and applied in the vertex shader in view space.
 */
export function createSkinnedLabelQuad(yOffset: number, jointIndex: number) {
  const geo = new THREE.BufferGeometry();
  // biome-ignore format: meaningful newlines
  geo.setAttribute("position", new THREE.Float32BufferAttribute([
    0, yOffset, 0,
    0, yOffset, 0,
    0, yOffset, 0,
    0, yOffset, 0,
  ], 3));
  // biome-ignore format: meaningful newlines
  geo.setAttribute("normal", new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3));
  // biome-ignore format: meaningful newlines
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([
    // aligned to canvas drawing
    0, 1,
    1, 1,
    1, 0,
    0, 0,
  ], 2));
  // biome-ignore format: meaningful newlines
  geo.setAttribute("billboardOffset", new THREE.Float32BufferAttribute([
    -1, -1,
     1, -1,
     1,  1,
    -1,  1,
  ], 2));
  // biome-ignore format: meaningful newlines
  geo.setIndex([
    0, 1, 2,
    0, 2, 3,
  ]);

  const skinIndices = new Uint16Array(16);
  const skinWeights = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    skinIndices[i * 4] = jointIndex;
    skinWeights[i * 4] = 1;
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  return geo;
}

/** Add a zero-filled `billboardOffset` vec2 attribute to a geometry. */
export function addEmptyBillboardOffset(geo: THREE.BufferGeometry) {
  const count = geo.getAttribute("position").count;
  geo.setAttribute("billboardOffset", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  return geo;
}

const rotMatLookup: Record<string, THREE.Matrix4> = {};
const tmpVectThree1 = new THREE.Vector3();

/**
 * Get a matrix which rotates around unit vector.
 * 🔔 May be mutated for "rotation around a point",
 * @see getRotAxisMatrix
 * @param ux unit vector x
 * @param uy unit vector y
 * @param uz unit vector z
 * @param degrees
 */
export function getRotAxisMatrix(ux: number, uy: number, uz: number, degrees: number) {
  const key = `${ux} ${uy} ${uz} ${degrees}`;
  return (rotMatLookup[key] ??= new THREE.Matrix4().makeRotationAxis(
    tmpVectThree1.set(ux, uy, uz),
    degrees * (Math.PI / 180),
  ));
}

/**
 * Mutate matrix `mat` so that:
 * > `mat := translate(cx, cy, cz) . mat . translate(-cx, -cy, -cz)`
 * @param mat
 * @param cx
 * @param cy
 * @param cz
 */
export function setRotMatrixAboutPoint(mat: THREE.Matrix4, cx: number, cy: number, cz: number): THREE.Matrix4 {
  const me = mat.elements;
  mat.elements[12] = me[0] * -cx + me[4] * -cy + me[8] * -cz + cx;
  mat.elements[13] = me[1] * -cx + me[5] * -cy + me[9] * -cz + cy;
  mat.elements[14] = me[2] * -cx + me[6] * -cy + me[10] * -cz + cz;
  return mat;
}

/**
 * Merge a base geometry with extra geometries, assigning each a material group index.
 * Returns the merged geometry with groups set up for a material array.
 */
export function mergeWithGroups(base: THREE.BufferGeometry, ...extras: THREE.BufferGeometry[]) {
  const merged = mergeGeometries([base, ...extras]);
  if (!merged) throw new Error("mergeGeometries failed");

  merged.clearGroups();
  let offset = 0;
  for (let i = 0; i < 1 + extras.length; i++) {
    const geo = i === 0 ? base : extras[i - 1];
    const count = geo.index ? geo.index.count : geo.getAttribute("position").count;
    merged.addGroup(offset, count, i);
    offset += count;
  }
  return merged;
}

/** Merge geometries without Three.js groups (→ 1 draw call).
 *  Adds float "groupId" attribute (0, 1, 2…) per vertex for shader branching. */
export function mergeWithGroupAttr(base: THREE.BufferGeometry, ...extras: THREE.BufferGeometry[]) {
  const geos = [base, ...extras];
  const merged = mergeGeometries(geos);
  if (!merged) throw new Error("mergeGeometries failed");
  merged.clearGroups();
  const counts = geos.map((g) => g.getAttribute("position").count);
  const total = counts.reduce((a, b) => a + b, 0);
  const groupIds = new Float32Array(total);
  let off = 0;
  for (let i = 0; i < geos.length; i++) {
    groupIds.fill(i, off, off + counts[i]);
    off += counts[i];
  }
  merged.setAttribute("groupId", new THREE.BufferAttribute(groupIds, 1));
  return merged;
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

//#region for raycast after object-pick

const tempInstanceMesh = new THREE.Mesh();
tempInstanceMesh.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const tempInstanceLocalMatrix = new THREE.Matrix4();
const tempInstanceWorldMatrix = new THREE.Matrix4();

export function getTempInstanceMesh(inst: THREE.InstancedMesh, instanceId: number) {
  if (inst.boundingSphere === null) inst.computeBoundingSphere();
  const matrixWorld = inst.matrixWorld;
  tempInstanceMesh.geometry = inst.geometry;
  inst.getMatrixAt(instanceId, tempInstanceLocalMatrix);
  tempInstanceMesh.matrixWorld = tempInstanceWorldMatrix.multiplyMatrices(matrixWorld, tempInstanceLocalMatrix);
  return tempInstanceMesh;
}

//#endregion

/**
 * Array or object, 2d or 3d
 */
export type PointAnyFormat =
  | [number, number, number]
  | [number, number]
  | { x: number; y: number; z: number }
  | { x: number; y: number };

export type GroundPoint = Geom.VectJson;

const tempNormal = {
  tri: new THREE.Triangle(),
  indices: new THREE.Vector3(),
  mat3: new THREE.Matrix3(),
};

/**
 * Convert `interseciton.normal` into world coordinates.
 */
export function computeIntersectionNormal(mesh: THREE.Mesh, intersection: THREE.Intersection) {
  const { indices, mat3, tri } = tempNormal;
  const output = new THREE.Vector3();
  const offset = (intersection.faceIndex as number) * 3;
  if (mesh.geometry.index === null) {
    indices.set(offset, offset + 1, offset + 2);
  } else {
    indices.fromArray(mesh.geometry.index.array, offset);
  }
  tri.setFromAttributeAndIndices(mesh.geometry.attributes.position, indices.x, indices.y, indices.z);
  tri.getNormal(output);
  const normalMatrix = mat3.getNormalMatrix(mesh.matrixWorld);
  output.applyNormalMatrix(normalMatrix);
  return output;
}

export const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 16, 1);

export const boxGeometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1).toNonIndexed();

/** Unit box from (0,0,0) to (1,1,1) with 6 or 2 material groups. */
export function createUnitBox(opts?: { singleFaceGroup?: boolean }) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0.5, 0.5, 0.5);

  if (opts?.singleFaceGroup) {
    // Reorder index buffer: non-top faces first (materialIndex 0), +y top face last (materialIndex 1).
    // BoxGeometry face order: +x(0-5) -x(6-11) +y(12-17) -y(18-23) +z(24-29) -z(30-35)
    const src = (geo.index as THREE.BufferAttribute).array;
    const dst = new Uint16Array(36);
    dst.set(src.slice(0, 12), 0); // +x, -x
    dst.set(src.slice(18, 36), 12); // -y, +z, -z
    dst.set(src.slice(12, 18), 30); // +y (top)
    geo.setIndex(new THREE.BufferAttribute(dst, 1));
    geo.groups = [
      { start: 0, count: 30, materialIndex: 0 },
      { start: 30, count: 6, materialIndex: 1 },
    ];
  }

  return geo;
}
