/**
 * @source https://github.com/isaac-mason/navcat/blob/main/examples/src/example-tiled-navmesh.ts
 */

import { warn } from "@npc-cli/util/legacy/generic";
import { generateTiledNavMesh, type TiledNavMeshInput, type TiledNavMeshOptions } from "navcat/blocks";
import { getPositionsAndIndices } from "navcat/three";
import * as THREE from "three";
import { computeGmInstanceMeshes } from "./nav-util";

/* navmesh generation parameters */
const config = {
  // cellSize: 0.05,

  // 0.05 * 30 === 1.5
  // cellSize: 0.05,
  // tileSizeVoxels: 30,
  cellSize: 0.1,
  tileSizeVoxels: 15,

  cellHeight: 0.001,
  walkableRadiusWorld: 0.1,
  walkableClimbWorld: 0,
  walkableHeightWorld: 0.25,
  walkableSlopeAngleDegrees: 45,
  borderSize: 4,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxSimplificationError: 1.3,
  maxEdgeLength: 12,
  maxVerticesPerPoly: 5,
  detailSampleDistance: 6,
  detailSampleMaxError: 1,
} as const satisfies Partial<TiledNavMeshOptions>;

export async function generateTiledNavMeshResult(
  gmGeoms: WW.GmGeomForNav[],
): Promise<import("navcat/blocks").TiledNavMeshResult> {
  const { meshes } = await computeGmInstanceMeshes(gmGeoms);

  if (meshes.length === 0) {
    warn("🤖 nav.worker: map has no meshes, adding dummy 10x10 plane");
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial());
    plane.rotation.x = -Math.PI / 2;
    meshes.push(plane);
  }

  meshes.push(computeNavOriginFixingMesh(meshes));

  const walkableMeshes = meshes;
  const [positions, indices] = getPositionsAndIndices(walkableMeshes);
  const navMeshInput: TiledNavMeshInput = {
    positions,
    indices,
  };

  const tileSizeWorld = config.tileSizeVoxels * config.cellSize;
  const walkableRadiusVoxels = Math.ceil(config.walkableRadiusWorld / config.cellSize);
  const walkableClimbVoxels = Math.ceil(config.walkableClimbWorld / config.cellHeight);
  const walkableHeightVoxels = Math.ceil(config.walkableHeightWorld / config.cellHeight);

  const detailSampleDistance = config.detailSampleDistance < 0.9 ? 0 : config.cellSize * config.detailSampleDistance;
  const detailSampleMaxError = config.cellHeight * config.detailSampleMaxError;

  const navMeshConfig: TiledNavMeshOptions = {
    cellSize: config.cellSize,
    cellHeight: config.cellHeight,
    tileSizeVoxels: config.tileSizeVoxels,
    tileSizeWorld,
    walkableRadiusWorld: config.walkableRadiusWorld,
    walkableRadiusVoxels,
    walkableClimbWorld: config.walkableClimbWorld,
    walkableClimbVoxels,
    walkableHeightWorld: config.walkableHeightWorld,
    walkableHeightVoxels,
    walkableSlopeAngleDegrees: config.walkableSlopeAngleDegrees,
    borderSize: config.borderSize,
    minRegionArea: config.minRegionArea,
    mergeRegionArea: config.mergeRegionArea,
    maxSimplificationError: config.maxSimplificationError,
    maxEdgeLength: config.maxEdgeLength,
    maxVerticesPerPoly: config.maxVerticesPerPoly,
    detailSampleDistance,
    detailSampleMaxError,
  };

  return generateTiledNavMesh(navMeshInput, navMeshConfig);
}

function computeNavOriginFixingMesh(meshes: THREE.Mesh[]) {
  const boxAll = new THREE.Box3();
  const box = new THREE.Box3();
  meshes.forEach((mesh) => boxAll.union(box.setFromObject(mesh)));
  const dx = (((boxAll.min.x % 1.5) + 1.5) % 1.5) - 1.5;
  const dz = (((boxAll.min.z % 1.5) + 1.5) % 1.5) - 1.5;
  const origin = new THREE.Vector3(boxAll.min.x - dx - 1.5, 0, boxAll.min.z - dz - 1.5);
  const originForcingMesh = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial());
  originForcingMesh.position.copy(origin);
  originForcingMesh.updateMatrixWorld();
  return originForcingMesh;
}
