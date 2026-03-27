import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const";
import * as geometry from "../service/geometry";
import { createXyQuad } from "../service/geometry";
import { createInstancedTransparentMaterial } from "../service/shader";
import { WorldContext } from "./world-context";

export default function Walls() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null,
      quad: createXyQuad(),

      getWallMat([u, v], transform, determinant, height, baseHeight) {
        tmpMat1.setMatrixValue(transform);
        if (determinant > 0) {
          // (v, u) so outer walls are shown
          [tmpVec1.copy(v), tmpVec2.copy(u)].forEach((x) => tmpMat1.transformPoint(x));
        } else {
          // (u, v) because transform flips
          [tmpVec1.copy(u), tmpVec2.copy(v)].forEach((x) => tmpMat1.transformPoint(x));
        }
        const rad = Math.atan2(tmpVec2.y - tmpVec1.y, tmpVec2.x - tmpVec1.x);
        const len = u.distanceTo(v);
        return geometry.embedXZMat4(
          {
            a: len * Math.cos(rad),
            b: len * Math.sin(rad),
            c: -Math.sin(rad),
            d: Math.cos(rad),
            e: tmpVec1.x,
            f: tmpVec1.y,
          },
          { yScale: height ?? wallHeight, yHeight: baseHeight, mat4: tmpMatFour1 },
        );
      },

      positionInstances() {
        const { inst: ws } = state;
        if (!ws) return;

        let instanceId = 0;
        const instanceIds: number[] = [];
        const color = new THREE.Color(0, 0, 0);

        for (const [_gmId, { key: gmKey, transform, determinant }] of w.gms.entries()) {
          for (const { seg, meta } of w.gmsData.byKey[gmKey].wallSegs) {
            ws.setMatrixAt(
              instanceId,
              state.getWallMat(
                seg,
                transform,
                determinant,
                typeof meta.h === "number" ? meta.h : undefined,
                typeof meta.y === "number" ? meta.y : undefined,
              ),
            );

            color.set(meta.lintel ? 1 : 0, 0, 0);
            ws.setColorAt(instanceId, color);
            instanceIds.push(instanceId++);
          }
        }

        state.quad.setAttribute("instanceIds", new THREE.InstancedBufferAttribute(new Uint32Array(instanceIds), 1));
        ws.computeBoundingSphere();
        ws.instanceMatrix.needsUpdate = true;
      },
    }),
  );

  const wallCount = w.gmsData.count.wall;

  const mat = useMemo(() => createInstancedTransparentMaterial(wallCount, 0.5), [wallCount]);

  useEffect(() => {
    state.positionInstances();
  }, [w.mapKey, w.hash]);

  return wallCount ? (
    <instancedMesh
      name="walls"
      ref={state.ref("inst")}
      args={[state.quad, undefined, wallCount]}
      material={mat.material}
    />
  ) : null;
}

type State = {
  inst: null | THREE.InstancedMesh;
  quad: THREE.BufferGeometry;
  getWallMat: (
    seg: [Geom.Vect, Geom.Vect],
    transform: Geom.AffineTransform,
    determinant: number,
    height?: number,
    baseHeight?: number,
  ) => THREE.Matrix4;
  positionInstances: () => void;
};

const tmpMat1 = new Mat();
const tmpVec1 = new Vect();
const tmpVec2 = new Vect();
const tmpMatFour1 = new THREE.Matrix4();
