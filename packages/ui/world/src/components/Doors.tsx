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

  const state = useStateRef(
    (): State => ({
      box: new THREE.BoxGeometry(1, 1, 1),
      inst: null,
      openDoorsRatio: new Float32Array(0),
      /** Per-instance [closedX, closedZ, slideDirX, slideDirZ, len] (stride 5) */
      slideData: new Float32Array(0),

      decodeInstanceId(instanceId: number) {
        let doorId = instanceId; // one seg per door
        const gmId = w.gms.findIndex(({ key }) => {
          const count = w.gmsData.byKey[key].doorSegs.length;
          return doorId < count || ((doorId -= count), false);
        });
        const gm = w.gms[gmId];
        const door = gm.doors[doorId];

        const { seg, hull } = w.gmsData.byKey[gm.key].doorSegs[doorId];
        const { meta } = door;

        const slideDirection = Array.isArray(meta.slideDirection)
          ? new Vect(...meta.slideDirection)
          : seg[1].clone().sub(seg[0]).normalize();

        return { gmId, doorId, seg, hull, ...meta, slideDirection };
      },

      setOpen(instanceId: number, ratio: number) {
        const { inst, openDoorsRatio, slideData } = state;
        if (!inst || instanceId < 0 || instanceId >= openDoorsRatio.length) return;
        openDoorsRatio[instanceId] = ratio;

        const i = instanceId * 5;
        const offset = ratio * slideData[i + 4]; // len
        inst.getMatrixAt(instanceId, tmpMat4);
        tmpMat4.elements[12] = slideData[i] + offset * slideData[i + 2];
        tmpMat4.elements[14] = slideData[i + 1] + offset * slideData[i + 3];
        inst.setMatrixAt(instanceId, tmpMat4);
        inst.instanceMatrix.needsUpdate = true;
      },

      positionInstances() {
        const { inst } = state;
        if (!inst) return;

        const n = w.gmsData.count.door;
        if (state.openDoorsRatio.length !== n) {
          state.openDoorsRatio = new Float32Array(n);
          state.slideData = new Float32Array(n * 5);
        }

        let instanceId = 0;
        for (const gm of w.gms) {
          const { key: gmKey, transform, determinant } = gm;
          tmpMat.setMatrixValue(transform);
          const doorSegs = w.gmsData.byKey[gmKey].doorSegs;

          for (let localId = 0; localId < doorSegs.length; localId++) {
            const door = doorSegs[localId];
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

            // store per-instance slide data: [closedX, closedZ, slideDirX, slideDirZ, len]
            const i = instanceId * 5;
            state.slideData[i] = mx;
            state.slideData[i + 1] = mz;
            state.slideData[i + 4] = len;

            // SVG (x,y) → world (x, 0, y), transformed by geomorph
            const connector = gm.doors[localId];
            const sd = connector?.meta?.slideDirection;
            if (Array.isArray(sd)) {
              tmpV1.set(sd[0], sd[1]);
              tmpMat.transformSansTranslate(tmpV1);
              state.slideData[i + 2] = tmpV1.x;
              state.slideData[i + 3] = tmpV1.y;
            } else {
              state.slideData[i + 2] = nx;
              state.slideData[i + 3] = nz;
            }

            // x-axis along door width, y-axis up, z-axis along panel depth
            // biome-ignore format: matrix layout
            tmpMat4.set(
              len * nx,  0,           -depth * nz,  mx,
              0,         doorHeight,   0,            doorHeight / 2,
              len * nz,  0,            depth * nx,   mz,
              0,         0,            0,            1,
            );

            // apply existing open ratio
            const r = state.openDoorsRatio[instanceId];
            if (r > 0) {
              const offset = r * len;
              tmpMat4.elements[12] += offset * state.slideData[i + 2];
              tmpMat4.elements[14] += offset * state.slideData[i + 3];
            }

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
      args={[state.box, undefined, doorCount]}
      material={materials}
      renderOrder={3}
    />
  ) : null;
}

export type State = {
  box: THREE.BoxGeometry;
  inst: null | THREE.InstancedMesh;
  openDoorsRatio: Float32Array;
  /** Per-instance [closedX, closedZ, slideDirX, slideDirZ, len] (stride 5) */
  slideData: Float32Array;
  decodeInstanceId: (instanceId: number) => {
    gmId: number;
    doorId: number;
    seg: [Geom.Vect, Geom.Vect];
    hull: boolean;
  };
  setOpen: (instanceId: number, ratio: number) => void;
  positionInstances: () => void;
};

const doorHeight = 2;
const panelDepth = 0.08;
const hullPanelDepth = 0.2;
const tmpMat = new Mat();
const tmpV1 = new Vect();
const tmpV2 = new Vect();
const tmpMat4 = new THREE.Matrix4();
