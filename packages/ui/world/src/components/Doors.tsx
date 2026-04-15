import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import { float, instanceIndex, int, texture, uv } from "three/tsl";
import * as THREE from "three/webgpu";
import { objectPick, PICK_TYPE, withPickOutput } from "../service/pick";
import { createPanelAtlas } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Doors() {
  const w = useContext(WorldContext);
  const doorCount = w.gmsData.count.door;

  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  const state = useStateRef(
    (): State => ({
      inst: null,

      decodeInstanceId(instanceId: number) {
        let id = instanceId;
        const gmId = w.gms.findIndex(({ key }) => {
          const count = w.gmsData.byKey[key].doorSegs.length;
          return id < count || ((id -= count), false);
        });
        const doorSeg = w.gmsData.byKey[w.gms[gmId].key].doorSegs[id];
        return { gmId, seg: doorSeg.seg, hull: doorSeg.hull };
      },

      positionInstances() {
        const { inst } = state;
        if (!inst) return;

        let instanceId = 0;
        for (const { key: gmKey, transform, determinant } of w.gms) {
          tmpMat.setMatrixValue(transform);
          for (const door of w.gmsData.byKey[gmKey].doorSegs) {
            if (!("seg" in door)) continue; // stale HMR data
            const {
              seg: [u, v],
              hull,
            } = door;
            if (determinant > 0) {
              tmpV1.copy(v);
              tmpV2.copy(u);
            } else {
              tmpV1.copy(u);
              tmpV2.copy(v);
            }
            tmpMat.transformPoint(tmpV1);
            tmpMat.transformPoint(tmpV2);

            const dx = tmpV2.x - tmpV1.x - 0.01; // fix z-fighting
            const dz = tmpV2.y - tmpV1.y; // Vect.y → world Z
            const len = tmpV1.distanceTo(tmpV2);
            const nx = len > 0 ? dx / len : 1;
            const nz = len > 0 ? dz / len : 0;
            const mx = (tmpV1.x + tmpV2.x) / 2;
            const mz = (tmpV1.y + tmpV2.y) / 2;
            const depth = hull ? hullPanelDepth : panelDepth;

            // x-axis along door width, y-axis up, z-axis along panel depth
            // biome-ignore format: matrix layout
            tmpMat4.set(
              len * nx,  0,           -depth * nz,  mx,
              0,         doorHeight,   0,            doorHeight / 2,
              len * nz,  0,            depth * nx,   mz,
              0,         0,            0,            1,
            );
            inst.setMatrixAt(instanceId++, tmpMat4);
          }
        }

        inst.computeBoundingSphere();
        inst.instanceMatrix.needsUpdate = true;
      },
    }),
  );

  w.doors = state;

  useEffect(() => {
    state.positionInstances();
  }, [w.mapKey, w.hash, w.gms.length]);

  // BoxGeometry groups: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z (front), 5 -z (back)
  const materials = useMemo(() => {
    const edge = new THREE.MeshStandardMaterial({ color: "#000000", metalness: 0.8, roughness: 0.3 });
    const top = new THREE.MeshStandardMaterial({ color: "#000000", metalness: 0.6, roughness: 0.3 });

    const { atlas, count } = createPanelAtlas();
    const material = new THREE.MeshStandardNodeMaterial({
      metalness: 0.7,
      roughness: 0.25,
      side: THREE.DoubleSide,
      transparent: true,
    });
    const texNode = texture(atlas, uv());
    material.colorNode = texNode.depth(instanceIndex.mod(int(count)));
    material.opacityNode = objectPick.equal(1).select(float(1), float(0.7));
    material.outputNode = withPickOutput(PICK_TYPE.doors);

    return [edge, edge, top, edge, material, material];
  }, []);

  return doorCount ? (
    <instancedMesh
      name="doors"
      ref={state.ref("inst")}
      args={[box, undefined, doorCount]}
      material={materials}
      renderOrder={3}
    />
  ) : null;
}

export type State = {
  inst: null | THREE.InstancedMesh;
  decodeInstanceId: (instanceId: number) => { gmId: number; seg: [Geom.Vect, Geom.Vect]; hull: boolean };
  positionInstances: () => void;
};

const doorHeight = 2;
const panelDepth = 0.08;
const hullPanelDepth = 0.2;
const tmpMat = new Mat();
const tmpV1 = new Vect();
const tmpV2 = new Vect();
const tmpMat4 = new THREE.Matrix4();
