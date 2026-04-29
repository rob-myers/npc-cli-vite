import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import { attribute, float, instanceIndex, int, positionLocal, texture, uv, vec2, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { helper } from "../service/helper";
import { PICK_TYPE } from "../service/pick";
import { createPanelAtlas } from "../service/texture";
import { WorldContext } from "./world-context";

export default function Doors() {
  const w = useContext(WorldContext);
  const instanceCount = w.gms.length << 8;

  const state = useStateRef(
    (): State => ({
      box: createDoorBox(),
      inst: null,
      openRatioArray: new Float32Array(0),
      animTargets: new Map(),

      encodeGmDoorId(gmId: number, doorId: number) {
        return (gmId << 8) | doorId;
      },
      decodeInstanceId(instanceId) {
        const gmId = instanceId >> 8;
        const doorId = instanceId & 0xff;
        const gdKey = helper.getGmDoorKey(gmId, doorId);
        const gm = w.gms[gmId];
        const { seg, hull } = w.gmsData.byKey[gm.key].doorSegs[doorId];
        const { meta, roomIds } = gm.doors[doorId];
        return { gmId, doorId, gdKey, seg, hull, roomIds, ...meta };
      },
      isOpen(gmId, doorId) {
        return state.openRatioArray[state.encodeGmDoorId(gmId, doorId)] > doorOpenTest;
      },
      positionInstances() {
        const { inst } = state;
        if (!inst) return;

        const n = w.gms.length << 8;
        if (state.openRatioArray.length !== n) {
          state.openRatioArray = new Float32Array(n);
        }

        const slideSignArray = new Float32Array(n).fill(1);

        // zero-scale all instances so unused slots are invisible
        zeroMat4.makeScale(0, 0, 0);
        for (let i = 0; i < n; i++) {
          inst.setMatrixAt(i, zeroMat4);
        }

        for (let gmId = 0; gmId < w.gms.length; gmId++) {
          const gm = w.gms[gmId];
          const { key: gmKey, transform, determinant } = gm;
          tmpMat.setMatrixValue(transform);
          const doorSegs = w.gmsData.byKey[gmKey].doorSegs;

          for (let localId = 0; localId < doorSegs.length; localId++) {
            const door = doorSegs[localId];
            if (!("seg" in door)) continue;
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

            const dx = tmpV2.x - tmpV1.x - 0.01;
            const dz = tmpV2.y - tmpV1.y;
            const len = tmpV1.distanceTo(tmpV2);
            const nx = len > 0 ? dx / len : 1;
            const nz = len > 0 ? dz / len : 0;
            const mx = (tmpV1.x + tmpV2.x) / 2;
            const mz = (tmpV1.y + tmpV2.y) / 2;
            const depth = hull ? hullPanelDepth : panelDepth;

            const instanceId = state.encodeGmDoorId(gmId, localId);

            const sd = gm.doors[localId]?.meta?.slideDirection;
            if (Array.isArray(sd)) {
              tmpV1.set(sd[0], sd[1]);
              tmpMat.transformSansTranslate(tmpV1);
              slideSignArray[instanceId] = tmpV1.x * nx + tmpV1.y * nz >= 0 ? 1 : -1;
            }

            // biome-ignore format: matrix layout
            tmpMat4.set(
              len * nx,  0,           -depth * nz,  mx,
              0,         doorHeight,   0,            doorHeight / 2,
              len * nz,  0,            depth * nx,   mz,
              0,         0,            0,            1,
            );

            inst.setMatrixAt(instanceId, tmpMat4);
          }
        }

        state.box.setAttribute("openRatio", new THREE.InstancedBufferAttribute(state.openRatioArray, 1));
        state.box.setAttribute("slideSign", new THREE.InstancedBufferAttribute(slideSignArray, 1));

        inst.computeBoundingSphere();
        inst.instanceMatrix.needsUpdate = true;
      },
      setOpen(gmId, doorId, open) {
        const isOpen = state.isOpen(gmId, doorId);
        if (typeof open === "boolean" && open === isOpen) {
          return;
        }
        const shouldOpen = open === undefined ? !isOpen : open;
        const instanceId = state.encodeGmDoorId(gmId, doorId);
        state.animTargets.set(instanceId, shouldOpen ? doorOpenTarget : 0);
        w.events.next({
          key: shouldOpen ? "door-opening" : "door-closing",
          open: isOpen,
          ...state.decodeInstanceId(instanceId),
        });
      },
      onTick(delta: number) {
        if (state.animTargets.size === 0) return;
        let changed = false;
        for (const [instanceId, target] of state.animTargets) {
          const cur = state.openRatioArray[instanceId];
          const next = cur + Math.sign(target - cur) * delta * doorSpeed;
          if ((target - cur) * (target - next) <= 0) {
            // finished animation
            state.openRatioArray[instanceId] = target;
            state.animTargets.delete(instanceId);
            const open = target > doorOpenTest;
            w.events.next({ key: open ? "door-open" : "door-closed", open, ...state.decodeInstanceId(instanceId) });
          } else {
            state.openRatioArray[instanceId] = next;
          }
          changed = true;
        }
        if (changed) {
          const attr = state.box.getAttribute("openRatio") as THREE.BufferAttribute | undefined;
          if (attr) attr.needsUpdate = true;
          if (w.disabled) w.view.forceUpdate();
        }
      },
    }),
  );

  w.door = state;

  useEffect(() => {
    state.positionInstances();
  }, [w.mapKey, w.hash, w.gms.length]);

  // BoxGeometry groups: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z (front), 5 -z (back)
  const materials = useMemo(() => {
    const edge = new THREE.MeshStandardNodeMaterial({ color: "#fff", metalness: 0.8, roughness: 0.3 });
    const top = new THREE.MeshStandardNodeMaterial({ color: "#fff", metalness: 0.6, roughness: 0.3 });

    const { atlas, count } = createPanelAtlas();
    const panelOpts = { metalness: 0.7, roughness: 0.25, side: THREE.DoubleSide, transparent: false, depthWrite: true };
    const front = new THREE.MeshStandardNodeMaterial(panelOpts);
    const back = new THREE.MeshStandardNodeMaterial(panelOpts);

    const openRatio = attribute("openRatio", "float");
    const slideSign = attribute("slideSign", "float");
    const cs = float(1).sub(openRatio);
    const collapsedX = positionLocal.x.mul(cs).add(slideSign.mul(openRatio).mul(0.5));

    for (const mat of [edge, top, front, back]) {
      mat.positionNode = vec3(collapsedX, positionLocal.y, positionLocal.z);
      mat.outputNode = w.view.withPickOutput(PICK_TYPE.door);
    }

    const texLayer = instanceIndex.mod(int(count));
    const frontOffset = slideSign.negate().greaterThan(0).select(openRatio, float(0));
    front.colorNode = texture(atlas, vec2(uv().x.mul(cs).add(frontOffset), uv().y)).depth(texLayer);
    const backOffset = slideSign.greaterThan(0).select(openRatio, float(0));
    back.colorNode = texture(atlas, vec2(uv().x.mul(cs).add(backOffset), uv().y)).depth(texLayer);

    return [edge, edge, top, edge, front, back];
  }, []);

  return instanceCount ? (
    <instancedMesh
      name="doors"
      ref={state.ref("inst")}
      args={[state.box, undefined, instanceCount]}
      material={materials}
      renderOrder={4}
    />
  ) : null;
}

export type State = {
  box: THREE.BoxGeometry;
  inst: null | THREE.InstancedMesh;
  openRatioArray: Float32Array;
  animTargets: Map<number, number>;
  encodeGmDoorId: (gmId: number, doorId: number) => number;
  decodeInstanceId: (instanceId: number) => Geomorph.GmDoorId & {
    seg: [Geom.Vect, Geom.Vect];
    hull: boolean;
  };
  isOpen: (gmId: number, doorId: number) => boolean;
  /** Toggles when `open` is `undefined`. */
  setOpen: (gmId: number, doorId: number, open?: boolean) => void;
  onTick: (delta: number) => void;
  positionInstances: () => void;
};

function createDoorBox() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.setAttribute("openRatio", new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
  g.setAttribute("slideSign", new THREE.InstancedBufferAttribute(new Float32Array([1]), 1));
  return g;
}

const doorHeight = 2 - 0.001;
const doorSpeed = 2;
const doorOpenTarget = 0.9;
const doorOpenTest = 0.8;
const panelDepth = 0.08;
const hullPanelDepth = 0.2;
const tmpMat = new Mat();
const tmpV1 = new Vect();
const tmpV2 = new Vect();
const tmpMat4 = new THREE.Matrix4();
const zeroMat4 = new THREE.Matrix4();
