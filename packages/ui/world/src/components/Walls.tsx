import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import { float, instancedArray, instanceIndex, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const";
import * as geometry from "../service/geometry";
import { createXyQuad } from "../service/geometry";
import { objectPick, PICK_TYPE, withPickOutput } from "../service/pick";
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

      decodeInstanceId(instanceId: number) {
        let id = instanceId;
        const gmId = w.gms.findIndex(({ key }) => {
          const count = w.gmsData.byKey[key].wallSegs.length;
          return id < count || ((id -= count), false);
        });
        const wallSeg = w.gmsData.byKey[w.gms[gmId].key].wallSegs[id];
        return { gmId, seg: wallSeg.seg, meta: wallSeg.meta };
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

  w.walls = state;

  const wallCount = w.gmsData.count.wall;

  const mat = useMemo(() => {
    // 🚧 move elsewhere
    const colorsBuffer = instancedArray(wallCount, "vec4");
    const colorData = colorsBuffer.value.array as Float32Array;
    for (let i = 0; i < wallCount; i++) {
      colorData[i * 4 + 3] = 0.3; // partial transparency
    }

    const material = new THREE.MeshStandardNodeMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    const instanceColor = colorsBuffer.element(instanceIndex);
    material.colorNode = vec4(instanceColor.x, instanceColor.y, instanceColor.z, 1.0);
    material.opacityNode = objectPick.equal(1).select(float(1), instanceColor.w);
    material.outputNode = withPickOutput(PICK_TYPE.walls);

    return { material, colorsBuffer };
  }, [wallCount]);

  useEffect(() => {
    state.positionInstances();
  }, [w.mapKey, w.hash, w.gms.length]);

  return wallCount ? (
    <instancedMesh
      // visible={false}
      name="walls"
      ref={state.ref("inst")}
      args={[state.quad, undefined, wallCount]}
      material={mat.material}
    />
  ) : null;
}

export type State = {
  inst: null | THREE.InstancedMesh;
  quad: THREE.BufferGeometry;
  decodeInstanceId: (instanceId: number) => { gmId: number; seg: [Geom.Vect, Geom.Vect]; meta: Meta };
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
