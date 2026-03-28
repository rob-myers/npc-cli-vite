/**
 * @source https://github.com/isaac-mason/navcat/blob/main/examples/src/example-tiled-navmesh.ts
 */

import type { MapEditSavedFile } from "@npc-cli/ui__map-edit/editor.schema";
import { fetchParsed, getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { warn } from "@npc-cli/util/legacy/generic";
import { generateTiledNavMesh, type TiledNavMeshInput, type TiledNavMeshOptions } from "navcat/blocks";
import { getPositionsAndIndices } from "navcat/three";
import * as THREE from "three";
import { AssetsSchema } from "../assets.schema";
import * as geomorph from "../service/geomorph";
import { recomputeHullSymbolUsingDrafts } from "../service/recompute-layout";
import { computeGmInstanceMeshes } from "./nav-util";

/* navmesh generation parameters */
const config = {
  cellSize: 0.15,
  cellHeight: 0.15,
  tileSizeVoxels: 32,
  walkableRadiusWorld: 0.1,
  walkableClimbWorld: 0.5,
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
};

export async function computeMapGmInstances(
  mapKey = "demo-map-0",
  mapEditDrafts?: MapEditSavedFile[],
): Promise<Geomorph.LayoutInstance[]> {
  // 🚧 no need to refetch every time
  const assets = await fetchParsed(`/assets.json${getDevCacheBustQueryParam()}`, AssetsSchema);
  if (mapEditDrafts) {
    recomputeHullSymbolUsingDrafts(assets, mapEditDrafts);
  }

  const mapDef = assets.map[mapKey]!;
  const gms = mapDef.gms.map(({ gmKey, transform }, gmId) =>
    geomorph.createLayoutInstance(assets.layout[gmKey] as Geomorph.Layout, gmId, transform),
  );
  return gms;
}

export default async function generateTiledNavMeshResult(
  mapGmInstances: Geomorph.LayoutInstance[],
): Promise<import("navcat/blocks").TiledNavMeshResult> {
  // generate scene from provided polygons
  const scene = new THREE.Scene();
  const { meshes } = await computeGmInstanceMeshes(mapGmInstances);

  if (meshes.length === 0) {
    warn("🤖 nav.worker: map has no meshes, adding dummy 10x10 plane");
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial());
    plane.rotation.x = -Math.PI / 2;
    meshes.push(plane);
  }

  meshes.forEach((mesh) => scene.add(mesh));

  /* generate navmesh */
  const walkableMeshes: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      walkableMeshes.push(object);
    }
  });

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
