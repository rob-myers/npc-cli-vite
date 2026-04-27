import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import { float, uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import { wallHeight } from "../const";
import * as geometry from "../service/geometry";
import { createXyQuad } from "../service/geometry";
import { PICK_TYPE } from "../service/pick";
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
        const color = new THREE.Color(w.getTheme().walls.color);

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

            ws.setColorAt(instanceId++, color);
          }
        }

        ws.computeBoundingSphere();
        ws.instanceMatrix.needsUpdate = true;
        if (ws.instanceColor) ws.instanceColor.needsUpdate = true;
      },
    }),
  );

  w.wall = state;

  const wallCount = w.gmsData.count.wall;

  const mat = useMemo(() => {
    const opacityUniform = uniform(0.5);
    const material = new THREE.MeshStandardNodeMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    material.opacityNode = w.view.objectPick.equal(1).select(float(1), opacityUniform);
    material.outputNode = w.view.withPickOutput(PICK_TYPE.wall);

    return { material, opacityUniform, uuid: crypto.randomUUID() };
  }, [wallCount]);

  useEffect(() => {
    state.positionInstances();
    mat.opacityUniform.value = w.getTheme().walls.opacity;
    w.update(); // 🔔 must sync onchange theme
  }, [w.mapKey, w.hash, w.gms.length, w.themeKey]);

  return wallCount ? (
    <instancedMesh
      // visible={false}
      key={mat.uuid}
      name="walls"
      ref={state.ref("inst")}
      args={[state.quad, undefined, wallCount]}
      material={mat.material}
      renderOrder={4}
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
