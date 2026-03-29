import type { StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { Mat } from "@npc-cli/util/geom/mat";
import { Rect } from "@npc-cli/util/geom/rect";
import { Vect } from "@npc-cli/util/geom/vect";
import { debug, mapValues } from "@npc-cli/util/legacy/generic";
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
    "total vertices": meshes.reduce((agg, mesh) => agg + (mesh.geometry.getAttribute("position")?.count ?? 0), 0),
    "total triangles": meshes.reduce((agg, mesh) => agg + (mesh.geometry.index?.count ?? 0) / 3, 0),
    "total meshes": meshes.length,
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

export type FloorNavTris = { [gmKey in StarShipGeomorphKey]: [number[], number[]][] };

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
export function navForFloorDraw(gmGeoms: WW.GmGeomForNav[], nav: NavMesh): FloorNavTris {
  const gmKeyToFirst = gmGeoms.reduce(
    (agg, gm) => ((agg[gm.key] ??= gm), agg),
    {} as Record<StarShipGeomorphKey, WW.GmGeomForNav>,
  );
  const toNavTris: FloorNavTris = mapValues(gmKeyToFirst, () => []);

  /** Those geomorph instances which are 1st for their gmKey */
  const firstGms = Object.values(gmKeyToFirst);
  const v2d = new Vect();

  const tiles = Object.values(nav.tiles);
  for (const tile of tiles) {
    const point = { x: (tile.bounds[0] + tile.bounds[3]) * 0.5, y: (tile.bounds[2] + tile.bounds[5]) * 0.5 };
    const gm = firstGms.find((x) => tmpRect.copy(x.gridRect).contains(point));
    if (gm === undefined) continue;

    const tileTris = getTileTriangles(tile); // [positions, indices][]

    // apply inverseTransform because we'll draw in local coords
    tileTris[0].forEach((t, i, positions) => {
      if (i % 3 === 0) {
        // x -> x
        v2d.x = t;
      } else if (i % 3 === 2) {
        // z -> y
        v2d.y = t;
        tmpMat3.setMatrixValue(gm.inverseMat3).transformPoint(v2d);
        positions[i - 2] = v2d.x;
        positions[i] = v2d.y;
      }
    });

    toNavTris[gm.key].push(tileTris);
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

const tmpRect = new Rect();
const tmpMat3 = new Mat();
const tmpMatrix4 = new THREE.Matrix4();
