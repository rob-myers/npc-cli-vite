import * as THREE from "three";
import { decompToXZGeometry } from "../service/geometry";

export function computeGmInstanceMesh(gm: Geomorph.LayoutInstance): {
  mesh: THREE.Mesh;
  customAreaDefs: TileCacheConvexAreaDef[];
} {
  const mesh = new THREE.Mesh(decompToXZGeometry(gm.navDecomp, { reverse: gm.determinant === 1 }));
  mesh.applyMatrix4(gm.mat4);
  mesh.updateMatrixWorld();

  const customAreaDefs: TileCacheConvexAreaDef[] = [];

  return { mesh, customAreaDefs };
}

export interface TileCacheConvexAreaDef {
  areaId: number;
  areas: {
    /** Must define a convex polygon */
    verts: import("three").Vector3Like[];
    hmin: number;
    hmax: number;
  }[];
}
