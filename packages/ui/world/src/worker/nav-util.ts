import { Mat } from "@npc-cli/util/geom/mat";
import { Poly } from "@npc-cli/util/geom/poly";
import { Rect } from "@npc-cli/util/geom/rect";
import { Vect } from "@npc-cli/util/geom/vect";
import { debug, warn } from "@npc-cli/util/legacy/generic";
import type { NavMesh, NavMeshTile } from "navcat";
import * as THREE from "three";
import { decompToXZGeometry } from "../service/geometry";

export async function computeGmInstanceMeshes(gmGeoms: WW.GmGeomForNav[]) {
  const meshes = [] as THREE.Mesh[];
  const customAreaDefs = [] as TileCacheConvexAreaDef[];
  for (const { mesh, customAreaDefs } of gmGeoms.map(computeGmInstanceMesh)) {
    meshes.push(mesh);
    customAreaDefs.push(...customAreaDefs);
  }

  debug("🤖 nav.worker", {
    "input meshes": meshes.length,
    "input vertices": meshes.reduce((agg, mesh) => agg + (mesh.geometry.getAttribute("position")?.count ?? 0), 0),
    "input triangles": meshes.reduce((agg, mesh) => agg + (mesh.geometry.index?.count ?? 0) / 3, 0),
  });

  return { meshes, customAreaDefs };
}

function computeGmInstanceMesh(gmGeom: WW.GmGeomForNav): {
  mesh: THREE.Mesh;
  customAreaDefs: TileCacheConvexAreaDef[];
} {
  const triangulation: Geom.Triangulation = {
    tris: gmGeom.triangulation.tris,
    vs: gmGeom.triangulation.vs.map(({ x, y }) => new Vect(x, y)),
  };

  const mesh = new THREE.Mesh(decompToXZGeometry(triangulation, { reverse: gmGeom.determinant === 1 }));
  mesh.applyMatrix4(tmpMatrix4.fromArray(gmGeom.mat4Array));
  mesh.updateMatrixWorld();

  const customAreaDefs: TileCacheConvexAreaDef[] = []; // 🚧

  return { mesh, customAreaDefs };
}

/** Indexed by `gmId` */
export type GmFloorNavTris = [number[], number[]][][];

export interface TileCacheConvexAreaDef {
  areaId: number;
  areas: {
    /** Must define a convex polygon */
    verts: import("three").Vector3Like[];
    hmin: number;
    hmax: number;
  }[];
}

/**
 * 🔔 We use @see {WW.GmGeomForNav} instead of @see {Geomorph.LayoutInstance}
 * to avoid HMR issues related to shared webworker code.
 */
export function navForFloorDraw(gmGeoms: WW.GmGeomForNav[], nav: NavMesh): GmFloorNavTris {
  if (gmGeoms.length === 0) return []; // skip empty-map

  const toNavTris: GmFloorNavTris = gmGeoms.map(() => []);
  const v2d = new Vect();

  const tiles = Object.values(nav.tiles);
  for (const tile of tiles) {
    const center = { x: (tile.bounds[0] + tile.bounds[3]) * 0.5, y: (tile.bounds[2] + tile.bounds[5]) * 0.5 };

    // 🚧 1 or 2 gms containing center
    // const gm = firstGms.find((x) => tmpRect.copy(x.gridRect).contains(center));
    const gmsContainingTile = gmGeoms.filter((x) => tmpRect.copy(x.worldBounds).contains(center));
    if (gmsContainingTile.length === 0) {
      warn("🤖 nav.worker: skipping tile outside all gms", { center });
      continue;
    }

    const [worldPositions, indices] = getTileTriangles(tile);

    for (const [_gmGeomIndex, gmGeom] of gmsContainingTile.entries()) {
      const localPositions = worldPositions.slice(); // copy per gm

      // apply inverseTransform to (flat) positiions because we'll draw in local coords
      localPositions.forEach((t, i, positions) => {
        if (i % 3 === 0) {
          // x -> x
          v2d.x = t;
        } else if (i % 3 === 2) {
          // z -> y
          v2d.y = t;
          tmpMat3.setMatrixValue(gmGeom.inverseMat3).transformPoint(v2d);
          positions[i - 2] = v2d.x;
          positions[i] = v2d.y;

          // 🚧 WIP expect hull door triangle in 2 gms
          // console.log(gmGeomIndex);
        }
      });

      const gmId = gmGeoms.indexOf(gmGeom);
      toNavTris[gmId].push([localPositions, indices]);
    }
  }

  return toNavTris;
}

function getTileTriangles(tile: NavMeshTile): [number[], number[]] {
  const positions = [] as number[];
  const indices = [] as number[];

  // tile.polys
  const tilePolyCount = tile.polys.length;
  let tri = 0;

  for (let tilePolyIndex = 0; tilePolyIndex < tilePolyCount; ++tilePolyIndex) {
    const poly = tile.polys[tilePolyIndex];

    // 🤔 can poly be an off mesh connection?
    // if (poly.getType() === 1) continue;

    const polyVertCount = poly.vertices.length;
    const polyDetail = tile.detailMeshes[tilePolyIndex];
    const polyDetailTriBase = polyDetail.trianglesBase;
    const polyDetailTriCount = polyDetail.trianglesCount;

    for (let polyDetailTriIndex = 0; polyDetailTriIndex < polyDetailTriCount; ++polyDetailTriIndex) {
      const detailTrisBaseIndex = (polyDetailTriBase + polyDetailTriIndex) * 4;

      for (let trianglePoint = 0; trianglePoint < 3; ++trianglePoint) {
        if (tile.detailTriangles[detailTrisBaseIndex + trianglePoint] < polyVertCount) {
          const tileVertsBaseIndex = poly.vertices[tile.detailTriangles[detailTrisBaseIndex + trianglePoint]] * 3;

          positions.push(
            tile.vertices[tileVertsBaseIndex],
            tile.vertices[tileVertsBaseIndex + 1],
            tile.vertices[tileVertsBaseIndex + 2],
          );
        } else {
          const tileVertsBaseIndex =
            (polyDetail.verticesBase +
              tile.detailTriangles[detailTrisBaseIndex + trianglePoint] -
              poly.vertices.length) *
            3;

          positions.push(
            tile.detailVertices[tileVertsBaseIndex],
            tile.detailVertices[tileVertsBaseIndex + 1],
            tile.detailVertices[tileVertsBaseIndex + 2],
          );
        }

        indices.push(tri++);
      }
    }
  }

  return [positions, indices];
}

export type EnrichedDoorway = WW.GmDoorwayForNav & {
  rect: Rect;
};

export type DoorwayGrid = { [key in `${number},${number}`]: EnrichedDoorway[] };

/** Area IDs below this are reserved (0 = unwalkable, 1 = default walkable flag, etc.) */
export const DOORS_AREA_START = 10;
/** Large but in sync with `<Doors>` instancedId encoding */
const MAX_DOORS_PER_GEOMORPH = 256;

/** `<Doors>` instancedId encoding + `DOORS_AREA_START` */
export function encodeDoorAreaId(gmId: number, doorId: number): number {
  return DOORS_AREA_START + gmId * MAX_DOORS_PER_GEOMORPH + doorId;
}

export function decodeDoorAreaId(areaId: number): { gmId: number; doorId: number } {
  const id = areaId - DOORS_AREA_START;
  return { gmId: Math.floor(id / MAX_DOORS_PER_GEOMORPH), doorId: id % MAX_DOORS_PER_GEOMORPH };
}

export function isDoorAreaId(areaId: number): boolean {
  return areaId >= DOORS_AREA_START;
}

export function buildDoorwayGrid(
  doorways: WW.GmDoorwayForNav[],
  meshBoundsMinX: number,
  meshBoundsMinZ: number,
  tileSizeWorld: number,
): DoorwayGrid {
  const enrichedDoorways: EnrichedDoorway[] = doorways.map((door) => ({
    ...door,
    rect: Poly.from(door.polygon).rect,
  }));

  const grid: DoorwayGrid = {};
  for (const door of enrichedDoorways) {
    const minGX = Math.floor((door.rect.x - meshBoundsMinX) / tileSizeWorld);
    const minGY = Math.floor((door.rect.y - meshBoundsMinZ) / tileSizeWorld);
    const maxGX = Math.floor((door.rect.x + door.rect.width - meshBoundsMinX) / tileSizeWorld);
    const maxGY = Math.floor((door.rect.y + door.rect.height - meshBoundsMinZ) / tileSizeWorld);
    for (let gx = minGX; gx <= maxGX; gx++) {
      for (let gy = minGY; gy <= maxGY; gy++) {
        const key = `${gx},${gy}` as `${number},${number}`;
        (grid[key] ??= []).push(door);
      }
    }
  }
  return grid;
}

const tmpRect = new Rect();
const tmpMat3 = new Mat();
const tmpMatrix4 = new THREE.Matrix4();
